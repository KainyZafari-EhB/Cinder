import { autoGrow, h } from './dom';
import { loadState, saveState } from './vscode';

const SEND_ICON = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';

export interface ComposerOptions {
	placeholder: string;
	label: string;
	onSubmit(text: string): void;
	onStop?(): void;
	/** Extra controls on the left of the action row, e.g. a project picker. */
	accessory?: HTMLElement;
}

/** The message box, with the ember line that glows while Claude works. */
export class Composer {
	readonly element: HTMLElement;
	private readonly input: HTMLTextAreaElement;
	private readonly action: HTMLButtonElement;
	private busy = false;

	constructor(private readonly options: ComposerOptions) {
		this.input = h('textarea', {
			rows: 1,
			placeholder: options.placeholder,
			'aria-label': options.label,
			spellcheck: 'true',
		});
		this.input.value = loadState().draft ?? '';
		this.input.addEventListener('input', () => {
			saveState({ draft: this.input.value });
			this.action.classList.toggle('empty', this.input.value.trim() === '');
		});
		this.input.addEventListener('keydown', event => {
			if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				this.submit();
			} else if (event.key === 'Escape' && this.busy) {
				this.options.onStop?.();
			}
		});
		autoGrow(this.input);

		this.action = h('button', { class: 'send', type: 'button', onclick: () => (this.busy ? this.options.onStop?.() : this.submit()) });

		this.element = h('div', { class: 'composer' },
			h('div', { class: 'ember-line', 'aria-hidden': 'true' }),
			this.input,
			h('div', { class: 'composer-row' },
				options.accessory ?? h('span'),
				this.action,
			),
		);
		this.setBusy(false);
	}

	setBusy(busy: boolean): void {
		this.busy = busy && this.options.onStop !== undefined;
		this.element.classList.toggle('busy', busy);
		this.action.classList.toggle('stop', this.busy);
		this.action.classList.toggle('empty', this.input.value.trim() === '');
		this.action.innerHTML = this.busy ? STOP_ICON : SEND_ICON;
		this.action.setAttribute('aria-label', this.busy ? 'Stop Claude' : 'Send message');
		this.action.title = this.busy ? 'Stop (Esc)' : 'Send (Enter)';
	}

	focus(): void {
		this.input.focus();
	}

	private submit(): void {
		const text = this.input.value.trim();
		if (!text) {
			return;
		}
		this.options.onSubmit(text);
		this.input.value = '';
		this.input.dispatchEvent(new Event('input'));
		saveState({ draft: '' });
	}
}
