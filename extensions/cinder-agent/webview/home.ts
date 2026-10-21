import type { ConversationSummary, HomeState } from '../src/protocol';
import { Composer } from './composer';
import { h, relativeTime } from './dom';
import { loadState, post, saveState } from './vscode';

const CHOOSE_FOLDER = '';

export function renderHome(root: HTMLElement, state: HomeState, markUrl: string): void {
	const picker = projectPicker(state);
	const composer = new Composer({
		placeholder: 'Ask Claude anything, or describe a change to make…',
		label: 'Message Claude',
		accessory: picker,
		onSubmit: text => post({ type: 'start', text, projectPath: picker.value || undefined, chooseFolder: picker.value === CHOOSE_FOLDER }),
	});

	const main = h('main', { class: 'home' },
		h('header', { class: 'brand' },
			h('img', { src: markUrl, alt: '', width: 22, height: 22 }),
			h('span', {}, 'Cinder'),
		),
		h('h1', { class: 'greeting' }, 'What\'s up?'),
		composer.element,
		!state.hasApiKey && h('p', { class: 'setup' },
			'Cinder talks to Claude with your own Anthropic API key. ',
			h('button', { class: 'link', type: 'button', onclick: () => post({ type: 'setApiKey' }) }, 'Add your API key'),
		),
		recentConversations(state.conversations),
	);

	root.replaceChildren(main);
	composer.focus();
}

function projectPicker(state: HomeState): HTMLSelectElement {
	const remembered = loadState().homeProject;
	const preferred = state.currentProject
		?? state.projects.find(p => p.path === remembered)?.path
		?? state.projects[0]?.path;

	const select = h('select', { class: 'project-picker', 'aria-label': 'Project' },
		...state.projects.map(project =>
			h('option', { value: project.path, selected: project.path === preferred, title: project.path }, project.name)),
		h('option', { value: CHOOSE_FOLDER, selected: preferred === undefined }, 'Choose a folder…'),
	);
	select.addEventListener('change', () => saveState({ homeProject: select.value }));
	return select;
}

function recentConversations(conversations: ConversationSummary[]): HTMLElement {
	if (conversations.length === 0) {
		return h('section', { class: 'recent empty' },
			h('p', {}, 'Your conversations show up here, each one linked to its project. Ask something above to start the first one.'),
		);
	}
	return h('section', { class: 'recent' },
		h('h2', {}, 'Recent conversations'),
		h('ol', {},
			...conversations.slice(0, 40).map(conversation => h('li', {},
				h('button', {
					class: 'conversation-row',
					type: 'button',
					title: `${conversation.title}\n${conversation.cwd}`,
					onclick: () => post({ type: 'openConversation', id: conversation.id, cwd: conversation.cwd }),
				},
					h('span', { class: 'row-title' }, conversation.title),
					h('span', { class: 'row-project' }, conversation.projectName),
					h('span', { class: 'row-time' }, relativeTime(conversation.updatedAt)),
				),
			)),
		),
	);
}
