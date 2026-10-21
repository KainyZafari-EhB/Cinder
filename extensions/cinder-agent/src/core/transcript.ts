import type { TranscriptItem } from '../protocol';
import { describeTool, toolResultText, truncate } from './toolSummary';

export interface TranscriptSink {
	upsert(item: TranscriptItem): void;
	appendText(id: string, text: string): void;
}

// Structural views of the SDK messages this file reads. Kept loose on
// purpose: the SDK's own types are much richer than what Cinder renders.
interface ContentBlock {
	type: string;
	id?: string;
	text?: string;
	thinking?: string;
	name?: string;
	input?: unknown;
	tool_use_id?: string;
	content?: unknown;
	is_error?: boolean;
}

interface StreamEvent {
	type: string;
	index?: number;
	message?: { id?: string };
	content_block?: ContentBlock;
	delta?: { type: string; text?: string; thinking?: string };
}

export interface AgentMessageLike {
	type: string;
	subtype?: string;
	uuid?: string;
	parent_tool_use_id?: string | null;
	event?: StreamEvent;
	message?: { id?: string; content?: unknown };
	error?: unknown;
	errors?: string[];
	is_error?: boolean;
	result?: string;
}

const OUTPUT_LIMIT = 4000;

/**
 * Turns the Agent SDK's message stream (or a saved session) into the flat
 * list of items the conversation view renders.
 */
export class TranscriptBuilder {
	readonly items: TranscriptItem[] = [];
	private readonly positions = new Map<string, number>();
	private readonly streamedMessages = new Set<string>();
	private readonly tools = new Map<string, { name: string; input: unknown }>();
	private currentMessageId: string | undefined;
	private counter = 0;
	/** Set when the user pressed Stop, so the resulting error reads as a stop. */
	interrupted = false;

	constructor(private readonly cwd: string, private readonly sink?: TranscriptSink) { }

	get(id: string): TranscriptItem | undefined {
		const position = this.positions.get(id);
		return position === undefined ? undefined : this.items[position];
	}

	toolInput(toolUseId: string): { name: string; input: unknown } | undefined {
		return this.tools.get(toolUseId);
	}

	upsert(item: TranscriptItem): void {
		const position = this.positions.get(item.id);
		if (position === undefined) {
			this.positions.set(item.id, this.items.length);
			this.items.push(item);
		} else {
			this.items[position] = item;
		}
		this.sink?.upsert(item);
	}

	appendText(id: string, text: string): void {
		const item = this.get(id);
		if (!item || !('text' in item) || !text) {
			return;
		}
		item.text += text;
		this.sink?.appendText(id, text);
	}

	addUser(text: string): void {
		this.upsert({ kind: 'user', id: this.nextId('user'), text });
	}

	notice(text: string, tone: 'info' | 'error' = 'info'): void {
		this.upsert({ kind: 'notice', id: this.nextId('notice'), tone, text });
	}

	/** Feeds one live message from `query()`. */
	handle(message: AgentMessageLike): void {
		// Subagent traffic is summarized by the parent's tool row instead.
		if (message.parent_tool_use_id) {
			return;
		}
		switch (message.type) {
			case 'stream_event':
				this.handleStreamEvent(message.event);
				break;
			case 'assistant':
				this.handleAssistant(message, false);
				break;
			case 'user':
				this.handleToolResults(message.message?.content);
				break;
			case 'result':
				if (this.interrupted) {
					this.interrupted = false;
					this.notice('Stopped.');
				} else if (message.subtype !== 'success' && message.subtype !== undefined) {
					const reason = message.errors?.filter(Boolean).join('\n') || describeResultError(message.subtype);
					this.notice(reason, 'error');
				}
				break;
			case 'system':
				if (message.subtype === 'compact_boundary') {
					this.notice('Earlier messages were summarized to make room in the conversation.');
				}
				break;
		}
	}

	/** Feeds one message from a saved session (no streaming events). */
	handleSaved(message: AgentMessageLike): void {
		if (message.parent_tool_use_id) {
			return;
		}
		if (message.type === 'assistant') {
			this.handleAssistant(message, true);
			return;
		}
		if (message.type !== 'user') {
			return;
		}
		const content = message.message?.content;
		if (typeof content === 'string') {
			this.addSavedPrompt(content);
			return;
		}
		if (Array.isArray(content)) {
			const text = (content as ContentBlock[])
				.filter(block => block.type === 'text' && typeof block.text === 'string')
				.map(block => block.text)
				.join('\n');
			if (text) {
				this.addSavedPrompt(text);
			}
			this.handleToolResults(content);
		}
	}

	private addSavedPrompt(text: string): void {
		// Slash-command plumbing and system reminders are stored as user turns.
		const trimmed = text.trim();
		if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('Caveat:')) {
			return;
		}
		this.addUser(trimmed);
	}

	private handleStreamEvent(event: StreamEvent | undefined): void {
		if (!event) {
			return;
		}
		switch (event.type) {
			case 'message_start':
				this.currentMessageId = event.message?.id;
				if (this.currentMessageId) {
					this.streamedMessages.add(this.currentMessageId);
				}
				break;
			case 'content_block_start': {
				const block = event.content_block;
				const id = this.streamBlockId(event.index);
				if (!block || !id) {
					break;
				}
				if (block.type === 'text') {
					this.upsert({ kind: 'assistant', id, text: block.text ?? '' });
				} else if (block.type === 'thinking') {
					this.upsert({ kind: 'thinking', id, text: block.thinking ?? '' });
				}
				break;
			}
			case 'content_block_delta': {
				const id = this.streamBlockId(event.index);
				if (!id || !event.delta) {
					break;
				}
				if (event.delta.type === 'text_delta') {
					this.appendText(id, event.delta.text ?? '');
				} else if (event.delta.type === 'thinking_delta') {
					this.appendText(id, event.delta.thinking ?? '');
				}
				break;
			}
		}
	}

	private handleAssistant(message: AgentMessageLike, saved: boolean): void {
		const content = message.message?.content;
		if (!Array.isArray(content)) {
			return;
		}
		// API failures arrive as a synthetic assistant message; show our own
		// explanation instead of its terse text.
		if (message.error && !saved) {
			this.notice(describeAssistantError(message.error), 'error');
			return;
		}
		const messageId = message.message?.id;
		const streamed = !saved && messageId !== undefined && this.streamedMessages.has(messageId);

		(content as ContentBlock[]).forEach((block, index) => {
			if (block.type === 'tool_use' && block.id && block.name) {
				this.tools.set(block.id, { name: block.name, input: block.input });
				const label = describeTool(block.name, block.input, this.cwd);
				const existing = this.get(block.id);
				// A tool row may already have become an edit or permission card.
				if (!existing || existing.kind === 'tool') {
					this.upsert({ kind: 'tool', id: block.id, name: label.name, summary: label.summary, status: saved ? 'done' : 'running' });
				}
				return;
			}
			if (streamed) {
				return; // text and thinking already arrived as stream events
			}
			const id = `${message.uuid ?? messageId ?? this.nextId('a')}:${index}`;
			if (block.type === 'text' && block.text) {
				this.upsert({ kind: 'assistant', id, text: block.text });
			} else if (block.type === 'thinking' && block.thinking) {
				this.upsert({ kind: 'thinking', id, text: block.thinking });
			}
		});

	}

	private handleToolResults(content: unknown): void {
		if (!Array.isArray(content)) {
			return;
		}
		for (const block of content as ContentBlock[]) {
			if (block.type !== 'tool_result' || !block.tool_use_id) {
				continue;
			}
			const existing = this.get(block.tool_use_id);
			if (existing?.kind !== 'tool') {
				continue; // edits and permissions manage their own state
			}
			const output = truncate(toolResultText(block.content).trim(), OUTPUT_LIMIT);
			this.upsert({ ...existing, status: block.is_error ? 'error' : 'done', output: output || undefined });
		}
	}

	private streamBlockId(index: number | undefined): string | undefined {
		return this.currentMessageId === undefined || index === undefined ? undefined : `${this.currentMessageId}:${index}`;
	}

	private nextId(prefix: string): string {
		return `${prefix}-${Date.now().toString(36)}-${(this.counter++).toString(36)}`;
	}
}

function describeResultError(subtype: string): string {
	switch (subtype) {
		case 'error_max_turns':
			return 'Claude stopped after reaching the maximum number of steps. Send a message to let it continue.';
		case 'error_max_budget_usd':
			return 'Claude stopped because this conversation reached its spending limit.';
		default:
			return 'Claude stopped because of an error. Send a message to try again.';
	}
}

function describeAssistantError(error: unknown): string {
	switch (error) {
		case 'authentication_failed':
			return 'Your Anthropic API key was rejected. Run "Cinder: Set Anthropic API Key" to update it.';
		case 'billing_error':
			return 'Your Anthropic account has a billing problem. Check your plan and credits in the Claude Console.';
		case 'rate_limit':
			return 'Claude is rate limited right now. Wait a moment, then send your message again.';
		case 'overloaded':
			return 'Claude is overloaded right now. Wait a moment, then send your message again.';
		case 'model_not_found':
			return 'The model in the "cinder.model" setting does not exist. Clear the setting or pick another model.';
		case 'max_output_tokens':
			return 'Claude\'s reply hit the length limit and was cut off.';
		default:
			return 'Claude could not finish this reply. Send your message again to retry.';
	}
}
