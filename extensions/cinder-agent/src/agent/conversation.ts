import type { HookCallback, PermissionResult, PermissionUpdate, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TranscriptItem } from '../protocol';
import { agentEnv } from '../core/agentEnv';
import { displayPath, resolvePath } from '../core/paths';
import { describeTool, EDIT_TOOLS, toolDetail } from '../core/toolSummary';
import { TranscriptBuilder } from '../core/transcript';
import type { EditRecord, EditTracker } from './edits';
import { PromptQueue } from './promptQueue';
import { loadAgentSdk } from './sdk';

export interface ConversationListener {
	upsert(item: TranscriptItem): void;
	appendText(id: string, text: string): void;
	busy(busy: boolean): void;
	/** The SDK assigned (or confirmed) this conversation's session id. */
	sessionStarted(sessionId: string): void;
	/** Claude changed a file and it should be shown as a diff. */
	editMade(record: EditRecord): void;
	log(line: string): void;
}

export interface ConversationOptions {
	cwd: string;
	apiKey: string;
	model?: string;
	/** Session to continue. Omit to start a new conversation. */
	resumeId?: string;
	edits: EditTracker;
	listener: ConversationListener;
}

interface PendingPermission {
	resolve(result: PermissionResult): void;
	input: Record<string, unknown>;
	suggestions?: PermissionUpdate[];
}

const EDIT_MATCHER = [...EDIT_TOOLS].join('|');

const CINDER_CONTEXT = [
	'You are running inside Cinder, a desktop IDE built around conversations with Claude.',
	'Every file you change is shown to the user as a diff they can keep or undo, so prefer focused edits over rewriting whole files.',
	'The user can see your file edits and tool calls; do not repeat file contents back in your replies.',
].join(' ');

/**
 * One conversation with Claude, backed by a long-lived Agent SDK query in
 * streaming-input mode. Owns the transcript, permission prompts and edits.
 */
export class Conversation {
	readonly transcript: TranscriptBuilder;
	private sessionId: string | undefined;
	private queue: PromptQueue<SDKUserMessage> | undefined;
	private query: Query | undefined;
	private running = false;
	private busy = false;
	private disposed = false;
	private readonly permissions = new Map<string, PendingPermission>();

	constructor(private readonly options: ConversationOptions) {
		this.sessionId = options.resumeId;
		this.transcript = new TranscriptBuilder(options.cwd, {
			upsert: item => options.listener.upsert(item),
			appendText: (id, text) => options.listener.appendText(id, text),
		});
	}

	get id(): string | undefined {
		return this.sessionId;
	}

	get cwd(): string {
		return this.options.cwd;
	}

	get isBusy(): boolean {
		return this.busy;
	}

	/** Fills the transcript from the saved session, without starting Claude. */
	async loadHistory(): Promise<void> {
		if (!this.sessionId) {
			return;
		}
		const sdk = await loadAgentSdk();
		const messages = await sdk.getSessionMessages(this.sessionId, { dir: this.options.cwd });
		for (const message of messages) {
			this.transcript.handleSaved(message as Parameters<TranscriptBuilder['handleSaved']>[0]);
		}
	}

	/** Used for the next Claude process this conversation starts. */
	setApiKey(apiKey: string): void {
		this.options.apiKey = apiKey;
	}

	send(text: string): void {
		if (this.disposed) {
			return;
		}
		this.transcript.addUser(text);
		this.setBusy(true);
		if (!this.running) {
			this.start();
		}
		this.queue!.push({
			type: 'user',
			message: { role: 'user', content: text },
			parent_tool_use_id: null,
			origin: { kind: 'human' },
		} as SDKUserMessage);
	}

	async stop(): Promise<void> {
		for (const [id, pending] of this.permissions) {
			pending.resolve({ behavior: 'deny', message: 'The user stopped Claude.', interrupt: true });
			this.updatePermission(id, 'denied');
		}
		this.permissions.clear();
		if (this.query && this.busy) {
			this.transcript.interrupted = true;
			await this.query.interrupt().catch(error => this.options.listener.log(`interrupt failed: ${error}`));
		}
	}

	answerPermission(id: string, allow: boolean, always: boolean): void {
		const pending = this.permissions.get(id);
		if (!pending) {
			return;
		}
		this.permissions.delete(id);
		this.updatePermission(id, allow ? 'allowed' : 'denied');
		pending.resolve(allow
			? { behavior: 'allow', updatedInput: pending.input, updatedPermissions: always ? pending.suggestions : undefined }
			: { behavior: 'deny', message: 'The user declined this action. Ask them how they would like to proceed.' });
	}

	setEditState(id: string, state: 'kept' | 'undone'): void {
		const item = this.transcript.get(id);
		if (item?.kind === 'edit') {
			this.transcript.upsert({ ...item, state });
		}
	}

	dispose(): void {
		this.disposed = true;
		for (const pending of this.permissions.values()) {
			pending.resolve({ behavior: 'deny', message: 'The conversation was closed.' });
		}
		this.permissions.clear();
		this.queue?.close();
		this.query?.close?.();
	}

	private start(): void {
		this.running = true;
		this.queue = new PromptQueue<SDKUserMessage>();
		void this.run(this.queue);
	}

	private async run(queue: PromptQueue<SDKUserMessage>): Promise<void> {
		const { listener } = this.options;
		try {
			const sdk = await loadAgentSdk();
			this.query = sdk.query({
				prompt: queue,
				options: {
					cwd: this.options.cwd,
					resume: this.sessionId,
					model: this.options.model || undefined,
					includePartialMessages: true,
					permissionMode: 'acceptEdits',
					canUseTool: (toolName, input, { signal, suggestions, toolUseID, title }) =>
						this.askPermission(toolName, input, signal, suggestions, toolUseID, title),
					hooks: {
						PreToolUse: [{ matcher: EDIT_MATCHER, hooks: [this.beforeEdit] }],
						PostToolUse: [{ matcher: EDIT_MATCHER, hooks: [this.afterEdit] }],
						PostToolUseFailure: [{ matcher: EDIT_MATCHER, hooks: [this.editFailed] }],
					},
					// Claude asks clarifying questions in its reply instead.
					disallowedTools: ['AskUserQuestion'],
					systemPrompt: { type: 'preset', preset: 'claude_code', append: CINDER_CONTEXT },
					settingSources: ['user', 'project', 'local'],
					env: agentEnv(process.env, this.options.apiKey),
					stderr: data => listener.log(data.trimEnd()),
				},
			});
			for await (const message of this.query) {
				this.onMessage(message);
			}
		} catch (error) {
			if (!this.disposed) {
				listener.log(`conversation failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
				this.transcript.notice(`Claude could not start: ${error instanceof Error ? error.message : String(error)}`, 'error');
			}
		} finally {
			// The process ended; the next message starts a new one that resumes
			// this session.
			this.running = false;
			this.query = undefined;
			queue.close();
			this.setBusy(false);
		}
	}

	private onMessage(message: SDKMessage): void {
		if ('session_id' in message && typeof message.session_id === 'string' && message.session_id !== this.sessionId) {
			this.sessionId = message.session_id;
			this.options.listener.sessionStarted(message.session_id);
		}
		this.transcript.handle(message as Parameters<TranscriptBuilder['handle']>[0]);
		if (message.type === 'result') {
			this.setBusy(false);
		}
	}

	private askPermission(
		toolName: string,
		input: Record<string, unknown>,
		signal: AbortSignal,
		suggestions: PermissionUpdate[] | undefined,
		toolUseId: string,
		title: string | undefined,
	): Promise<PermissionResult> {
		const id = `permission-${toolUseId}`;
		const label = describeTool(toolName, input, this.options.cwd);
		this.transcript.upsert({
			kind: 'permission',
			id,
			tool: label.name,
			summary: title ?? (label.summary || label.name),
			detail: toolDetail(toolName, input),
			state: 'asking',
		});
		return new Promise<PermissionResult>(resolve => {
			this.permissions.set(id, { resolve, input, suggestions });
			signal.addEventListener('abort', () => {
				if (this.permissions.delete(id)) {
					this.updatePermission(id, 'denied');
					resolve({ behavior: 'deny', message: 'The request was cancelled.' });
				}
			}, { once: true });
		});
	}

	private updatePermission(id: string, state: 'allowed' | 'denied'): void {
		const item = this.transcript.get(id);
		if (item?.kind === 'permission') {
			this.transcript.upsert({ ...item, state });
		}
	}

	private readonly beforeEdit: HookCallback = async input => {
		if (input.hook_event_name === 'PreToolUse') {
			const path = editedPath(input.tool_input);
			if (path) {
				await this.options.edits.snapshot(input.tool_use_id, resolvePath(path, this.options.cwd));
			}
		}
		return {};
	};

	private readonly afterEdit: HookCallback = async input => {
		if (input.hook_event_name !== 'PostToolUse') {
			return {};
		}
		const done = await this.options.edits.complete(input.tool_use_id);
		if (done) {
			this.transcript.upsert({
				kind: 'edit',
				id: input.tool_use_id,
				path: done.record.path,
				relPath: displayPath(done.record.path, this.options.cwd),
				added: done.added,
				removed: done.removed,
				created: done.created,
				state: 'review',
			});
			this.options.listener.editMade(done.record);
		}
		return {};
	};

	private readonly editFailed: HookCallback = async input => {
		if (input.hook_event_name === 'PostToolUseFailure') {
			this.options.edits.discard(input.tool_use_id);
		}
		return {};
	};

	private setBusy(busy: boolean): void {
		if (this.busy !== busy) {
			this.busy = busy;
			this.options.listener.busy(busy);
		}
	}
}

function editedPath(toolInput: unknown): string | undefined {
	if (!toolInput || typeof toolInput !== 'object') {
		return undefined;
	}
	const args = toolInput as Record<string, unknown>;
	const path = args.file_path ?? args.notebook_path;
	return typeof path === 'string' ? path : undefined;
}
