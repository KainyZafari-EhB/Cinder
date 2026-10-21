// Messages exchanged between the extension host and Cinder's webviews.
// Shared by both sides, so it must stay free of Node and VS Code imports.

export interface ConversationSummary {
	id: string;
	title: string;
	/** Project folder the conversation belongs to. */
	cwd: string;
	projectName: string;
	updatedAt: number;
	gitBranch?: string;
}

export interface ProjectSummary {
	path: string;
	name: string;
	lastActive: number;
}

export type ToolStatus = 'running' | 'done' | 'error';
export type EditState = 'review' | 'kept' | 'undone';
export type PermissionState = 'asking' | 'allowed' | 'denied';

/** One rendered entry in a conversation. Items are replaced by `id`. */
export type TranscriptItem =
	| { kind: 'user'; id: string; text: string }
	| { kind: 'assistant'; id: string; text: string }
	| { kind: 'thinking'; id: string; text: string }
	| { kind: 'tool'; id: string; name: string; summary: string; status: ToolStatus; output?: string }
	| { kind: 'edit'; id: string; path: string; relPath: string; added: number; removed: number; created: boolean; state: EditState }
	| { kind: 'permission'; id: string; tool: string; summary: string; detail?: string; state: PermissionState }
	| { kind: 'notice'; id: string; tone: 'info' | 'error'; text: string };

export interface HomeState {
	conversations: ConversationSummary[];
	projects: ProjectSummary[];
	hasApiKey: boolean;
	/** Folder open in this window, if any. */
	currentProject?: string;
}

export interface ConversationState {
	conversationId?: string;
	title: string;
	projectName: string;
	items: TranscriptItem[];
	busy: boolean;
	hasApiKey: boolean;
	/** Other conversations in this project, shown when nothing is open yet. */
	recent: ConversationSummary[];
}

/** The conversations of the project open in this window. */
export interface ConversationListState {
	projectName: string;
	/** The conversation open in the chat view, if it has been saved yet. */
	currentId?: string;
	busy: boolean;
	conversations: ConversationSummary[];
}

export type HostMessage =
	| { type: 'home'; state: HomeState }
	| { type: 'conversation'; state: ConversationState }
	| { type: 'conversations'; state: ConversationListState }
	| { type: 'upsert'; item: TranscriptItem }
	| { type: 'appendText'; id: string; text: string }
	| { type: 'busy'; busy: boolean }
	| { type: 'title'; title: string };

export type ViewMessage =
	| { type: 'ready' }
	| { type: 'send'; text: string }
	| { type: 'start'; text: string; projectPath?: string; chooseFolder?: boolean }
	| { type: 'openConversation'; id: string; cwd: string }
	| { type: 'stop' }
	| { type: 'permission'; id: string; allow: boolean; always: boolean }
	| { type: 'edit'; id: string; action: 'review' | 'keep' | 'undo' }
	| { type: 'openFile'; path: string }
	| { type: 'setApiKey' }
	| { type: 'pickFolder' }
	| { type: 'newConversation' }
	| { type: 'showConversations' }
	| { type: 'toggleFullWidth' }
	| { type: 'showHome' };
