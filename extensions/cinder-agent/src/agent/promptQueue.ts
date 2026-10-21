/**
 * An async iterable the Agent SDK reads prompts from. Keeping it open keeps
 * one Claude Code process alive for the whole conversation, so follow-up
 * messages and Stop work without restarting it.
 */
export class PromptQueue<T> implements AsyncIterable<T> {
	private readonly items: T[] = [];
	private wake: (() => void) | undefined;
	private closed = false;

	push(item: T): void {
		if (this.closed) {
			throw new Error('PromptQueue is closed');
		}
		this.items.push(item);
		this.wake?.();
	}

	close(): void {
		this.closed = true;
		this.wake?.();
	}

	get isClosed(): boolean {
		return this.closed;
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) {
			const next = this.items.shift();
			if (next !== undefined) {
				yield next;
				continue;
			}
			if (this.closed) {
				return;
			}
			await new Promise<void>(resolve => (this.wake = resolve));
			this.wake = undefined;
		}
	}
}
