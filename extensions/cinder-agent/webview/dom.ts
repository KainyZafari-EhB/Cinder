type Child = Node | string | false | null | undefined;
type Props = Record<string, string | boolean | number | EventListener | undefined>;

/** Tiny element builder: h('button', { class: 'x', onclick }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (value === undefined || value === false) {
			continue;
		}
		if (key.startsWith('on') && typeof value === 'function') {
			element.addEventListener(key.slice(2), value);
		} else if (value === true) {
			element.setAttribute(key, '');
		} else {
			element.setAttribute(key, String(value));
		}
	}
	append(element, children);
	return element;
}

export function append(parent: Node, children: Child[]): void {
	for (const child of children) {
		if (child === false || child === null || child === undefined) {
			continue;
		}
		parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
	}
}

export function relativeTime(timestamp: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
	if (seconds < 60) {
		return 'just now';
	}
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) {
		return `${minutes} min ago`;
	}
	const hours = Math.round(minutes / 60);
	if (hours < 24) {
		return `${hours} h ago`;
	}
	const days = Math.round(hours / 24);
	if (days === 1) {
		return 'yesterday';
	}
	if (days < 7) {
		return `${days} days ago`;
	}
	return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Grows a textarea with its content, up to its CSS max-height. */
export function autoGrow(textarea: HTMLTextAreaElement): void {
	const resize = () => {
		textarea.style.height = 'auto';
		textarea.style.height = `${textarea.scrollHeight}px`;
	};
	textarea.addEventListener('input', resize);
	requestAnimationFrame(resize);
}

export function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
