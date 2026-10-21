import type { ConversationSummary, ProjectSummary } from '../protocol';
import { folderName, sameFolder } from './paths';

/** The fields Cinder reads from the SDK's `SDKSessionInfo`. */
export interface SessionInfoLike {
	sessionId: string;
	summary: string;
	lastModified: number;
	customTitle?: string;
	firstPrompt?: string;
	gitBranch?: string;
	cwd?: string;
}

export function toConversation(session: SessionInfoLike): ConversationSummary | undefined {
	if (!session.cwd) {
		return undefined; // without a folder there is no project to open
	}
	const title = (session.customTitle || session.summary || session.firstPrompt || 'Untitled conversation')
		.replace(/\s+/g, ' ')
		.trim();
	return {
		id: session.sessionId,
		title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
		cwd: session.cwd,
		projectName: folderName(session.cwd),
		updatedAt: session.lastModified,
		gitBranch: session.gitBranch,
	};
}

export function toConversations(sessions: SessionInfoLike[]): ConversationSummary[] {
	return sessions
		.map(toConversation)
		.filter((c): c is ConversationSummary => c !== undefined)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Projects ordered by their most recent conversation. */
export function toProjects(conversations: ConversationSummary[], extraFolders: string[] = []): ProjectSummary[] {
	const projects: ProjectSummary[] = [];
	const upsert = (folder: string, lastActive: number) => {
		const existing = projects.find(p => sameFolder(p.path, folder));
		if (existing) {
			existing.lastActive = Math.max(existing.lastActive, lastActive);
		} else {
			projects.push({ path: folder, name: folderName(folder), lastActive });
		}
	};
	for (const conversation of conversations) {
		upsert(conversation.cwd, conversation.updatedAt);
	}
	for (const folder of extraFolders) {
		upsert(folder, 0);
	}
	return projects.sort((a, b) => b.lastActive - a.lastActive);
}
