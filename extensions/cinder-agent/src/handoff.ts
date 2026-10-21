import * as vscode from 'vscode';
import { sameFolder } from './core/paths';

const KEY = 'cinder.pendingHandoff';
const MAX_AGE_MS = 2 * 60 * 1000;

/**
 * What a window should do once it opens a project: continue a conversation
 * or start a new one. Opening a folder reloads the window (or opens a new
 * one), so the request travels through global state.
 */
export interface Handoff {
	cwd: string;
	sessionId?: string;
	prompt?: string;
	createdAt: number;
}

export class HandoffStore {
	constructor(private readonly state: vscode.Memento) { }

	async set(handoff: Omit<Handoff, 'createdAt'>): Promise<void> {
		await this.state.update(KEY, { ...handoff, createdAt: Date.now() } satisfies Handoff);
	}

	/** Returns and clears the handoff meant for `folder`, if there is one. */
	async take(folder: string | undefined): Promise<Handoff | undefined> {
		const handoff = this.state.get<Handoff>(KEY);
		if (!handoff || !folder || !sameFolder(handoff.cwd, folder)) {
			return undefined;
		}
		await this.state.update(KEY, undefined);
		return Date.now() - handoff.createdAt <= MAX_AGE_MS ? handoff : undefined;
	}
}
