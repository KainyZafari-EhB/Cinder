import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Conversation } from '../src/agent/conversation';
import { EditTracker } from '../src/agent/edits';
import type { TranscriptItem } from '../src/protocol';

// Starts a real Claude Code process through the Agent SDK.
// With ANTHROPIC_API_KEY set, Claude answers; without it, a fake key is used
// and the test checks that the rejection reaches the transcript.
describe('Conversation with the real Agent SDK', () => {
	it('runs a turn end to end', async () => {
		const realKey = process.env.ANTHROPIC_API_KEY;
		const cwd = mkdtempSync(join(tmpdir(), 'cinder-smoke-'));
		const logs: string[] = [];
		let busy = true;
		const idle = new Promise<void>(resolve => {
			const conversation = new Conversation({
				cwd,
				apiKey: realKey ?? 'sk-ant-api03-not-a-real-key',
				edits: new EditTracker(),
				listener: {
					upsert: () => { },
					appendText: () => { },
					busy: value => {
						busy = value;
						if (!value) {
							resolve();
						}
					},
					sessionStarted: id => logs.push(`session ${id}`),
					editMade: () => { },
					log: line => logs.push(line),
				},
			});
			conversation.send('Reply with exactly the word: ember');
			(globalThis as { conversation?: Conversation }).conversation = conversation;
		});
		await idle;
		const conversation = (globalThis as { conversation?: Conversation }).conversation!;
		const items: TranscriptItem[] = conversation.transcript.items;
		conversation.dispose();

		console.log(JSON.stringify(items, null, 2));
		console.log(logs.slice(-20).join('\n'));
		expect(busy).toBe(false);
		expect(items[0]).toMatchObject({ kind: 'user' });
		if (realKey) {
			expect(items.some(item => item.kind === 'assistant' && /ember/i.test(item.text))).toBe(true);
		} else {
			expect(items.some(item => item.kind === 'notice' && item.tone === 'error')).toBe(true);
		}
	});
});
