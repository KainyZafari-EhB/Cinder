import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EditTracker } from '../src/agent/edits';
import { PromptQueue } from '../src/agent/promptQueue';
import { agentEnv } from '../src/core/agentEnv';
import { toConversations, toProjects } from '../src/core/conversations';
import { countLineChanges } from '../src/core/lineDiff';
import { describeTool } from '../src/core/toolSummary';
import { TranscriptBuilder } from '../src/core/transcript';
import type { TranscriptItem } from '../src/protocol';

describe('countLineChanges', () => {
	it('counts a single changed line as one added and one removed', () => {
		expect(countLineChanges('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ added: 1, removed: 1 });
	});

	it('counts separate edits exactly instead of the whole region', () => {
		const before = ['1', '2', '3', '4', '5', '6', '7', '8'].join('\n');
		const after = ['1', 'two', '3', '4', '5', '6', 'seven', '8', '9'].join('\n');
		expect(countLineChanges(before, after)).toEqual({ added: 3, removed: 2 });
	});

	it('treats a new file as all added lines', () => {
		expect(countLineChanges('', 'x\ny\n')).toEqual({ added: 2, removed: 0 });
	});

	it('reports nothing for identical text', () => {
		expect(countLineChanges('same\n', 'same\n')).toEqual({ added: 0, removed: 0 });
	});
});

describe('TranscriptBuilder', () => {
	const stream = (event: object) => ({ type: 'stream_event', parent_tool_use_id: null, event });

	it('builds assistant text from stream events and ignores the final copy', () => {
		const builder = new TranscriptBuilder('/p');
		builder.handle(stream({ type: 'message_start', message: { id: 'm1' } }));
		builder.handle(stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
		builder.handle(stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } }));
		builder.handle(stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'there' } }));
		builder.handle({ type: 'assistant', parent_tool_use_id: null, uuid: 'u1', message: { id: 'm1', content: [{ type: 'text', text: 'Hello there' }] } });

		expect(builder.items).toEqual([{ kind: 'assistant', id: 'm1:0', text: 'Hello there' }]);
	});

	it('tracks a tool from call to result', () => {
		const builder = new TranscriptBuilder('/p');
		builder.handle({
			type: 'assistant', parent_tool_use_id: null, uuid: 'u1',
			message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] },
		});
		expect(builder.get('t1')).toMatchObject({ kind: 'tool', name: 'Terminal', summary: 'npm test', status: 'running' });

		builder.handle({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }] } });
		expect(builder.get('t1')).toMatchObject({ status: 'done', output: 'ok' });
	});

	it('does not turn an edit card back into a tool row', () => {
		const builder = new TranscriptBuilder('/p');
		const edit: TranscriptItem = { kind: 'edit', id: 't2', path: '/p/a.ts', relPath: 'a.ts', added: 1, removed: 0, created: false, state: 'review' };
		builder.upsert(edit);
		builder.handle({
			type: 'assistant', parent_tool_use_id: null, uuid: 'u2',
			message: { id: 'm2', content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/p/a.ts' } }] },
		});
		builder.handle({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'done' }] } });
		expect(builder.get('t2')).toEqual(edit);
	});

	it('replaces a synthetic API error reply with a clear notice', () => {
		const builder = new TranscriptBuilder('/p');
		builder.handle({ type: 'assistant', parent_tool_use_id: null, uuid: 'u', error: 'authentication_failed', message: { id: 'm', content: [{ type: 'text', text: 'Invalid API key' }] } });
		expect(builder.items).toMatchObject([{ kind: 'notice', tone: 'error' }]);
		expect(builder.items[0]).toMatchObject({ text: expect.stringContaining('API key was rejected') });
	});

	it('skips subagent messages', () => {
		const builder = new TranscriptBuilder('/p');
		builder.handle({ type: 'assistant', parent_tool_use_id: 'parent', uuid: 'u', message: { id: 'm', content: [{ type: 'text', text: 'hidden' }] } });
		expect(builder.items).toEqual([]);
	});

	it('reports a stop as a stop, not an error', () => {
		const builder = new TranscriptBuilder('/p');
		builder.interrupted = true;
		builder.handle({ type: 'result', subtype: 'error_during_execution' });
		expect(builder.items).toMatchObject([{ kind: 'notice', tone: 'info', text: 'Stopped.' }]);
	});

	it('loads saved sessions and hides command plumbing', () => {
		const builder = new TranscriptBuilder('/p');
		builder.handleSaved({ type: 'user', parent_tool_use_id: null, message: { content: '<command-name>/clear</command-name>' } });
		builder.handleSaved({ type: 'user', parent_tool_use_id: null, message: { content: 'Fix the login bug' } });
		builder.handleSaved({ type: 'assistant', parent_tool_use_id: null, uuid: 'a1', message: { id: 'm', content: [{ type: 'text', text: 'On it.' }] } });
		expect(builder.items.map(item => item.kind)).toEqual(['user', 'assistant']);
	});
});

describe('conversations', () => {
	it('groups sessions into projects, newest first, and skips sessions without a folder', () => {
		const conversations = toConversations([
			{ sessionId: 'a', summary: 'Old', lastModified: 1, cwd: '/work/eldendle' },
			{ sessionId: 'b', summary: 'New', lastModified: 5, cwd: '/work/cinder' },
			{ sessionId: 'c', summary: 'Nowhere', lastModified: 9 },
			{ sessionId: 'd', summary: 'Mid', customTitle: 'Renamed', lastModified: 3, cwd: '/work/eldendle/' },
		]);
		expect(conversations.map(c => c.title)).toEqual(['New', 'Renamed', 'Old']);
		expect(toProjects(conversations).map(p => [p.name, p.lastActive])).toEqual([['cinder', 5], ['eldendle', 3]]);
	});
});

describe('describeTool', () => {
	it('shows paths relative to the project', () => {
		expect(describeTool('Read', { file_path: '/p/src/app.ts' }, '/p')).toEqual({ name: 'Read', summary: 'src/app.ts' });
	});
});

describe('EditTracker', () => {
	it('records a change and undoes it', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'cinder-'));
		const file = join(dir, 'a.txt');
		writeFileSync(file, 'one\n');
		const tracker = new EditTracker();

		await tracker.snapshot('t1', file);
		writeFileSync(file, 'one\ntwo\n');
		const done = await tracker.complete('t1');
		expect(done).toMatchObject({ added: 1, removed: 0, created: false });

		expect(await tracker.undo('t1')).toBe('undone');
		expect(readFileSync(file, 'utf8')).toBe('one\n');
	});

	it('refuses to undo over later changes unless forced', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'cinder-'));
		const file = join(dir, 'b.txt');
		const tracker = new EditTracker();

		await tracker.snapshot('t1', file); // file does not exist yet
		writeFileSync(file, 'created\n');
		expect(await tracker.complete('t1')).toMatchObject({ created: true });

		writeFileSync(file, 'created\nedited by me\n');
		expect(await tracker.undo('t1')).toBe('changed-since');
		expect(await tracker.undo('t1', true)).toBe('undone');
		expect(existsSync(file)).toBe(false);
	});

	it('ignores tool runs that changed nothing', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'cinder-'));
		const file = join(dir, 'c.txt');
		writeFileSync(file, 'same');
		const tracker = new EditTracker();
		await tracker.snapshot('t1', file);
		expect(await tracker.complete('t1')).toBeUndefined();
	});
});

describe('PromptQueue', () => {
	it('delivers items pushed before and after iteration starts, then ends on close', async () => {
		const queue = new PromptQueue<number>();
		queue.push(1);
		const seen: number[] = [];
		const done = (async () => {
			for await (const item of queue) {
				seen.push(item);
			}
		})();
		await Promise.resolve();
		queue.push(2);
		queue.close();
		await done;
		expect(seen).toEqual([1, 2]);
	});
});

describe('agentEnv', () => {
	it('drops inherited Claude and Anthropic variables and sets the API key', () => {
		const env = agentEnv({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', ANTHROPIC_BASE_URL: 'http://proxy', ANTHROPIC_API_KEY: 'old' }, 'sk-ant-new');
		expect(env).toEqual({ PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant-new' });
	});
});
