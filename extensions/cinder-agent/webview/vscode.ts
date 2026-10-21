import type { ViewMessage } from '../src/protocol';

interface VsCodeApi {
	postMessage(message: ViewMessage): void;
	getState<T>(): T | undefined;
	setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function post(message: ViewMessage): void {
	api.postMessage(message);
}

interface SavedState {
	draft?: string;
	homeProject?: string;
}

export function loadState(): SavedState {
	return api.getState<SavedState>() ?? {};
}

export function saveState(patch: SavedState): void {
	api.setState({ ...loadState(), ...patch });
}
