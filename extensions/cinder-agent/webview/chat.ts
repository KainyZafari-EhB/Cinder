import type { ConversationListState, ConversationState, ConversationSummary, TranscriptItem } from '../src/protocol';
import { Composer } from './composer';
import { append, h, relativeTime } from './dom';
import { renderMarkdown } from './markdown';
import { post } from './vscode';

/**
 * The conversation view: transcript, empty state and composer, plus the
 * list of the project's conversations it can switch to.
 */
export class ChatScreen {
	private readonly root: HTMLElement;
	private readonly title: HTMLElement;
	private readonly project: HTMLElement;
	private readonly listButton: HTMLButtonElement;
	private readonly list: HTMLElement;
	private readonly transcript: HTMLElement;
	private readonly empty: HTMLElement;
	private readonly composer: Composer;
	private readonly elements = new Map<string, HTMLElement>();
	private readonly items = new Map<string, TranscriptItem>();
	private readonly pendingText = new Set<string>();
	private conversationTitle = '';
	private projectName = '';
	private listing = false;
	private frame = 0;

	constructor(container: HTMLElement) {
		this.title = h('div', { class: 'chat-title' });
		this.project = h('div', { class: 'chat-project' });
		this.listButton = h('button', {
			class: 'ghost head-button',
			type: 'button',
			onclick: () => this.listing ? this.showChat() : post({ type: 'showConversations' }),
		});
		this.list = h('div', { class: 'conversation-list' });
		this.transcript = h('div', { class: 'transcript', role: 'log', 'aria-live': 'polite' });
		this.empty = h('div', { class: 'chat-empty' });
		this.composer = new Composer({
			placeholder: 'Message Claude…',
			label: 'Message Claude',
			onSubmit: text => post({ type: 'send', text }),
			onStop: () => post({ type: 'stop' }),
		});
		this.root = h('div', { class: 'chat' },
			h('header', { class: 'chat-head' },
				this.listButton,
				h('div', { class: 'chat-heading' }, this.title, this.project),
				h('button', {
					class: 'ghost head-button',
					type: 'button',
					title: 'Fill the window, or show it beside the editor',
					onclick: () => post({ type: 'toggleFullWidth' }),
				}, 'Full width'),
			),
			this.list,
			h('div', { class: 'scroller' }, this.empty, this.transcript),
			this.composer.element,
		);
		container.replaceChildren(this.root);
		this.showChat();
	}

	show(state: ConversationState): void {
		this.conversationTitle = state.title;
		this.projectName = state.projectName;
		this.showChat();
		this.elements.clear();
		this.items.clear();
		this.transcript.replaceChildren();
		for (const item of state.items) {
			this.upsert(item, false);
		}
		this.renderEmpty(state);
		this.composer.setBusy(state.busy);
		this.scrollToEnd(true);
		this.composer.focus();
	}

	setTitle(title: string): void {
		this.conversationTitle = title;
		if (!this.listing) {
			this.title.textContent = title;
		}
	}

	/** Back from the list to the conversation, which kept running meanwhile. */
	showChat(): void {
		this.listing = false;
		this.root.classList.remove('listing');
		this.title.textContent = this.conversationTitle;
		this.project.textContent = this.projectName;
		this.listButton.textContent = '‹ Conversations';
		this.listButton.title = 'Other conversations in this project';
	}

	showList(state: ConversationListState): void {
		this.listing = true;
		this.root.classList.add('listing');
		this.title.textContent = 'Conversations';
		this.project.textContent = state.projectName;
		this.listButton.textContent = '‹ Back';
		this.listButton.title = 'Back to the open conversation';

		const rows = state.conversations.map(conversation => {
			const current = conversation.id === state.currentId;
			return h('li', {},
				h('button', {
					class: `conversation-row${current ? ' current' : ''}`,
					type: 'button',
					title: conversation.title,
					'aria-current': current ? 'true' : undefined,
					onclick: () => current
						? this.showChat()
						: post({ type: 'openConversation', id: conversation.id, cwd: conversation.cwd }),
				},
					h('span', { class: 'row-title' }, conversation.title),
					h('span', { class: 'row-time' }, current ? (state.busy ? 'working…' : 'open') : relativeTime(conversation.updatedAt)),
				),
			);
		});
		this.list.replaceChildren(h('div', { class: 'list-inner' },
			h('button', { class: 'quiet-primary', type: 'button', onclick: () => post({ type: 'newConversation' }) }, 'New conversation'),
			rows.length > 0
				? h('section', { class: 'recent compact' }, h('ol', {}, ...rows))
				: h('p', { class: 'list-empty' }, 'No conversations in this project yet.'),
			h('button', { class: 'ghost all-projects', type: 'button', onclick: () => post({ type: 'showHome' }) }, 'All projects'),
		));
	}

	setBusy(busy: boolean): void {
		this.composer.setBusy(busy);
	}

	upsert(item: TranscriptItem, scroll = true): void {
		const stick = scroll && this.isNearEnd();
		this.items.set(item.id, item);
		const next = renderItem(item);
		const current = this.elements.get(item.id);
		if (current) {
			current.replaceWith(next);
		} else {
			this.transcript.appendChild(next);
			this.empty.hidden = true;
		}
		this.elements.set(item.id, next);
		if (stick) {
			this.scrollToEnd(false);
		}
	}

	/** Streaming text: re-render at most once per frame. */
	appendText(id: string, text: string): void {
		const item = this.items.get(id);
		if (!item || !('text' in item)) {
			return;
		}
		item.text += text;
		this.pendingText.add(id);
		this.frame ||= requestAnimationFrame(() => {
			this.frame = 0;
			const stick = this.isNearEnd();
			for (const pending of this.pendingText) {
				const pendingItem = this.items.get(pending);
				const element = this.elements.get(pending);
				if (pendingItem && element) {
					updateText(element, pendingItem);
				}
			}
			this.pendingText.clear();
			if (stick) {
				this.scrollToEnd(false);
			}
		});
	}

	private renderEmpty(state: ConversationState): void {
		this.empty.hidden = state.items.length > 0;
		if (!state.projectName) {
			this.empty.replaceChildren(
				h('p', { class: 'empty-lead' }, 'Open a project to start a conversation about it.'),
				h('button', { class: 'primary', type: 'button', onclick: () => post({ type: 'showHome' }) }, 'Go to home'),
			);
			return;
		}
		this.empty.replaceChildren();
		append(this.empty, [
			h('p', { class: 'empty-lead' }, `What should we work on in ${state.projectName}?`),
			!state.hasApiKey && h('p', { class: 'setup' },
				'Claude needs your Anthropic API key first. ',
				h('button', { class: 'link', type: 'button', onclick: () => post({ type: 'setApiKey' }) }, 'Add your API key'),
			),
			state.recent.length > 0 && recentList(state.recent),
		]);
	}

	private isNearEnd(): boolean {
		const scroller = this.transcript.parentElement!;
		return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
	}

	private scrollToEnd(instant: boolean): void {
		const scroller = this.transcript.parentElement!;
		scroller.scrollTo({ top: scroller.scrollHeight, behavior: instant ? 'instant' : 'smooth' });
	}
}

function recentList(conversations: ConversationSummary[]): HTMLElement {
	return h('section', { class: 'recent compact' },
		h('h2', {}, 'Earlier in this project'),
		h('ol', {},
			...conversations.map(conversation => h('li', {},
				h('button', {
					class: 'conversation-row',
					type: 'button',
					onclick: () => post({ type: 'openConversation', id: conversation.id, cwd: conversation.cwd }),
				},
					h('span', { class: 'row-title' }, conversation.title),
					h('span', { class: 'row-time' }, relativeTime(conversation.updatedAt)),
				),
			)),
		),
	);
}

function renderItem(item: TranscriptItem): HTMLElement {
	switch (item.kind) {
		case 'user':
			return h('div', { class: 'msg user', 'data-id': item.id }, h('div', { class: 'user-text' }, item.text));
		case 'assistant': {
			const element = h('div', { class: 'msg assistant markdown', 'data-id': item.id });
			updateText(element, item);
			return element;
		}
		case 'thinking': {
			const body = h('div', { class: 'thinking-body' });
			const element = h('details', { class: 'msg thinking', 'data-id': item.id },
				h('summary', {}, 'Thinking'),
				body,
			);
			body.textContent = item.text;
			return element;
		}
		case 'tool':
			return renderTool(item);
		case 'edit':
			return renderEdit(item);
		case 'permission':
			return renderPermission(item);
		case 'notice':
			return h('p', { class: `msg notice ${item.tone}`, 'data-id': item.id, role: item.tone === 'error' ? 'alert' : undefined }, item.text);
	}
}

function updateText(element: HTMLElement, item: TranscriptItem): void {
	if (item.kind === 'assistant') {
		renderMarkdown(element, item.text);
	} else if (item.kind === 'thinking') {
		const body = element.querySelector('.thinking-body');
		if (body) {
			body.textContent = item.text;
		}
	}
}

function renderTool(item: Extract<TranscriptItem, { kind: 'tool' }>): HTMLElement {
	const row = [
		h('span', { class: 'status-dot', 'aria-hidden': 'true' }),
		h('span', { class: 'tool-name' }, item.name),
		h('span', { class: 'tool-summary mono' }, item.summary),
		item.status === 'error' && h('span', { class: 'tool-failed' }, 'failed'),
	];
	if (!item.output) {
		return h('div', { class: `msg tool ${item.status}`, 'data-id': item.id }, h('div', { class: 'tool-row' }, ...row));
	}
	return h('details', { class: `msg tool ${item.status}`, 'data-id': item.id },
		h('summary', { class: 'tool-row' }, ...row),
		h('pre', { class: 'tool-output mono' }, item.output),
	);
}

function renderEdit(item: Extract<TranscriptItem, { kind: 'edit' }>): HTMLElement {
	const act = (action: 'review' | 'keep' | 'undo') => () => post({ type: 'edit', id: item.id, action });
	const actions = item.state === 'review'
		? [
			h('button', { class: 'ghost', type: 'button', onclick: act('review') }, 'Review'),
			h('button', { class: 'ghost', type: 'button', onclick: act('undo') }, 'Undo'),
			h('button', { class: 'quiet-primary', type: 'button', onclick: act('keep') }, 'Keep'),
		]
		: [
			h('span', { class: 'edit-state' }, item.state === 'kept' ? 'Kept' : 'Undone'),
			item.state === 'kept' && h('button', { class: 'ghost', type: 'button', onclick: act('review') }, 'Review'),
		];
	return h('div', { class: `msg edit ${item.state}`, 'data-id': item.id },
		h('button', { class: 'edit-file mono', type: 'button', title: item.path, onclick: () => post({ type: 'openFile', path: item.path }) }, item.relPath),
		h('span', { class: 'edit-delta mono', 'aria-label': `${item.added} lines added, ${item.removed} removed` },
			item.created && h('span', { class: 'edit-new' }, 'new'),
			h('span', { class: 'added' }, `+${item.added}`),
			h('span', { class: 'removed' }, `−${item.removed}`),
		),
		h('span', { class: 'edit-actions' }, ...actions),
	);
}

function renderPermission(item: Extract<TranscriptItem, { kind: 'permission' }>): HTMLElement {
	const answer = (allow: boolean, always = false) => () => post({ type: 'permission', id: item.id, allow, always });
	const showDetail = item.detail && item.detail !== item.summary;
	return h('div', { class: `msg permission ${item.state}`, 'data-id': item.id },
		h('p', { class: 'permission-ask' }, `Allow Claude to use ${item.tool}?`),
		h('p', { class: 'permission-summary' }, item.summary),
		showDetail && h('pre', { class: 'permission-detail mono' }, item.detail!),
		item.state === 'asking'
			? h('div', { class: 'permission-actions' },
				h('button', { class: 'primary', type: 'button', onclick: answer(true) }, 'Allow'),
				h('button', { class: 'ghost', type: 'button', onclick: answer(true, true) }, 'Always allow'),
				h('button', { class: 'ghost', type: 'button', onclick: answer(false) }, 'Deny'),
			)
			: h('p', { class: 'permission-result' }, item.state === 'allowed' ? 'Allowed' : 'Denied'),
	);
}
