import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: false });

/** Renders Claude's markdown into sanitized HTML inside `target`. */
export function renderMarkdown(target: HTMLElement, source: string): void {
	const html = marked.parse(source, { async: false });
	target.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
	for (const pre of target.querySelectorAll('pre')) {
		decorateCodeBlock(pre);
	}
	for (const link of target.querySelectorAll('a')) {
		link.setAttribute('title', link.getAttribute('href') ?? '');
	}
}

function decorateCodeBlock(pre: HTMLPreElement): void {
	const code = pre.querySelector('code');
	const language = [...(code?.classList ?? [])].find(c => c.startsWith('language-'))?.slice('language-'.length);
	const bar = document.createElement('div');
	bar.className = 'code-bar';
	const label = document.createElement('span');
	label.textContent = language ?? 'code';
	const copy = document.createElement('button');
	copy.className = 'ghost small';
	copy.textContent = 'Copy';
	copy.addEventListener('click', () => {
		void navigator.clipboard.writeText(code?.textContent ?? pre.textContent ?? '');
		copy.textContent = 'Copied';
		setTimeout(() => (copy.textContent = 'Copy'), 1400);
	});
	bar.append(label, copy);
	pre.before(bar);
	const wrapper = document.createElement('div');
	wrapper.className = 'code-block';
	bar.before(wrapper);
	wrapper.append(bar, pre);
}
