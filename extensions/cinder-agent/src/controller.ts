import * as path from 'node:path';
import * as vscode from 'vscode';
import { Conversation } from './agent/conversation';
import { EditTracker, type EditRecord } from './agent/edits';
import { loadAgentSdk } from './agent/sdk';
import type { ApiKeyStore } from './apiKey';
import { toConversations, toProjects } from './core/conversations';
import { folderName, sameFolder } from './core/paths';
import { truncate } from './core/toolSummary';
import type { HandoffStore } from './handoff';
import type { ConversationState, ConversationSummary, HomeState, ViewMessage } from './protocol';
import type { ChatView, HomePanel, Surface } from './views/surfaces';

export const BEFORE_SCHEME = 'cinder-before';

/**
 * Ties Cinder together: the home screen, the conversation view, the active
 * conversation with Claude, and moving between projects.
 */
export class Controller implements vscode.Disposable, vscode.TextDocumentContentProvider {
	private conversation: Conversation | undefined;
	private title = 'New conversation';
	readonly edits = new EditTracker();
	private readonly disposables: vscode.Disposable[] = [];

	chatView!: ChatView;
	homePanel!: HomePanel;

	constructor(
		private readonly apiKeys: ApiKeyStore,
		private readonly handoffs: HandoffStore,
		private readonly output: vscode.LogOutputChannel,
	) {
		this.disposables.push(apiKeys.onDidChange(() => void this.refreshAll()));
	}

	get currentFolder(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	/** Runs once the window is up: finish a handoff, or show home. */
	async startup(): Promise<void> {
		const handoff = await this.handoffs.take(this.currentFolder);
		if (handoff?.sessionId) {
			await this.openConversation(handoff.sessionId, handoff.cwd);
		} else if (handoff?.prompt) {
			await this.startConversation(handoff.prompt, handoff.cwd);
		} else if (!this.currentFolder && vscode.workspace.getConfiguration('cinder').get('openHomeOnStartup', true)) {
			this.showHome();
		}
	}

	// --- messages from the webviews -------------------------------------

	readonly handleMessage = (message: ViewMessage, surface: Surface): void => {
		void this.dispatch(message, surface).catch(error => {
			this.output.error(error instanceof Error ? error : String(error));
			void vscode.window.showErrorMessage(`Cinder: ${error instanceof Error ? error.message : String(error)}`);
		});
	};

	private async dispatch(message: ViewMessage, surface: Surface): Promise<void> {
		switch (message.type) {
			case 'ready':
				if (surface === this.homePanel) {
					await this.refreshHome();
				} else {
					await this.postConversation();
				}
				break;
			case 'send':
				await this.send(message.text);
				break;
			case 'start':
				await this.startConversation(message.text, message.chooseFolder ? await this.pickFolder() : message.projectPath, message.chooseFolder);
				break;
			case 'openConversation':
				await this.openConversation(message.id, message.cwd);
				break;
			case 'stop':
				await this.conversation?.stop();
				break;
			case 'permission':
				this.conversation?.answerPermission(message.id, message.allow, message.always);
				break;
			case 'edit':
				await this.handleEdit(message.id, message.action);
				break;
			case 'openFile':
				await vscode.window.showTextDocument(vscode.Uri.file(this.resolveInProject(message.path)), { preview: true });
				break;
			case 'setApiKey':
				await this.apiKeys.prompt();
				break;
			case 'pickFolder': {
				const folder = await this.pickFolder();
				if (folder) {
					await this.openProject(folder, {});
				}
				break;
			}
			case 'newConversation':
				await this.newConversation();
				break;
			case 'showHome':
				this.showHome();
				break;
		}
	}

	// --- commands --------------------------------------------------------

	showHome(): void {
		this.homePanel.show();
	}

	async newConversation(): Promise<void> {
		if (!this.currentFolder) {
			this.showHome();
			return;
		}
		this.replaceConversation(undefined);
		this.title = 'New conversation';
		await this.chatView.reveal();
		await this.postConversation();
	}

	// --- conversations ---------------------------------------------------

	async openConversation(sessionId: string, cwd: string): Promise<void> {
		if (!this.currentFolder || !sameFolder(this.currentFolder, cwd)) {
			await this.openProject(cwd, { sessionId });
			return;
		}
		if (this.conversation?.id === sessionId) {
			await this.chatView.reveal();
			return;
		}
		const apiKey = (await this.apiKeys.get()) ?? '';
		const conversation = this.createConversation(cwd, apiKey, sessionId);
		this.replaceConversation(conversation);
		this.title = (await this.findConversation(sessionId))?.title ?? 'Conversation';
		await this.chatView.reveal();
		try {
			await conversation.loadHistory();
		} catch (error) {
			this.output.error(`could not load session ${sessionId}: ${error}`);
			conversation.transcript.notice('The earlier messages of this conversation could not be loaded.', 'error');
		}
		await this.postConversation();
	}

	async startConversation(text: string, projectPath?: string, folderWasPicked = false): Promise<void> {
		const folder = projectPath ?? (folderWasPicked ? undefined : this.currentFolder ?? (await this.pickFolder()));
		if (!folder) {
			return;
		}
		if (!this.currentFolder || !sameFolder(this.currentFolder, folder)) {
			await this.openProject(folder, { prompt: text });
			return;
		}
		this.replaceConversation(undefined);
		this.title = truncate(text.replace(/\s+/g, ' '), 80);
		await this.chatView.reveal();
		await this.postConversation();
		await this.send(text);
	}

	private async send(text: string): Promise<void> {
		const folder = this.currentFolder;
		if (!folder) {
			await this.startConversation(text);
			return;
		}
		const apiKey = await this.apiKeys.require();
		if (!apiKey) {
			return;
		}
		if (!this.conversation) {
			this.replaceConversation(this.createConversation(folder, apiKey, undefined));
			if (this.title === 'New conversation') {
				this.title = truncate(text.replace(/\s+/g, ' '), 80);
				this.chatView.post({ type: 'title', title: this.title });
			}
		}
		this.conversation!.setApiKey(apiKey);
		this.conversation!.send(text);
	}

	private createConversation(cwd: string, apiKey: string, resumeId: string | undefined): Conversation {
		const config = vscode.workspace.getConfiguration('cinder');
		const conversation: Conversation = new Conversation({
			cwd,
			apiKey,
			resumeId,
			model: config.get<string>('model'),
			edits: this.edits,
			listener: {
				upsert: item => this.isActive(conversation) && this.chatView.post({ type: 'upsert', item }),
				appendText: (id, text) => this.isActive(conversation) && this.chatView.post({ type: 'appendText', id, text }),
				busy: busy => this.isActive(conversation) && this.chatView.post({ type: 'busy', busy }),
				sessionStarted: () => void this.refreshHome(),
				editMade: record => this.isActive(conversation) && void this.reviewEdit(record, true),
				log: line => this.output.info(line),
			},
		});
		return conversation;
	}

	private isActive(conversation: Conversation): boolean {
		return this.conversation === conversation;
	}

	private replaceConversation(next: Conversation | undefined): void {
		this.conversation?.dispose();
		this.conversation = next;
	}

	// --- edits -----------------------------------------------------------

	private async handleEdit(id: string, action: 'review' | 'keep' | 'undo'): Promise<void> {
		const record = this.edits.get(id);
		if (!record) {
			void vscode.window.showWarningMessage('This change is from an earlier session, so Cinder no longer has the original to compare with.');
			return;
		}
		if (action === 'review') {
			await this.reviewEdit(record, false);
		} else if (action === 'keep') {
			this.conversation?.setEditState(id, 'kept');
		} else {
			let result = await this.edits.undo(id);
			if (result === 'changed-since') {
				const choice = await vscode.window.showWarningMessage(
					`${path.basename(record.path)} changed after Claude edited it. Undoing restores the version from before Claude's edit and drops those later changes.`,
					{ modal: true },
					'Undo anyway',
				);
				if (choice !== 'Undo anyway') {
					return;
				}
				result = await this.edits.undo(id, true);
			}
			if (result === 'undone') {
				this.conversation?.setEditState(id, 'undone');
			}
		}
	}

	private async reviewEdit(record: EditRecord, automatic: boolean): Promise<void> {
		if (automatic && !vscode.workspace.getConfiguration('cinder').get('reviewEdits', true)) {
			return;
		}
		const name = path.basename(record.path);
		const before = vscode.Uri.from({ scheme: BEFORE_SCHEME, path: `/${record.id}/${name}` });
		const after = vscode.Uri.file(record.path);
		if (record.after === null) {
			await vscode.window.showTextDocument(before, { preview: true, preserveFocus: automatic });
			return;
		}
		await vscode.commands.executeCommand('vscode.diff', before, after, `${name} (Claude's change)`, {
			preview: true,
			preserveFocus: automatic,
		} satisfies vscode.TextDocumentShowOptions);
	}

	/** Serves the "before" side of edit diffs. */
	provideTextDocumentContent(uri: vscode.Uri): string {
		const id = uri.path.split('/')[1];
		return this.edits.get(id)?.before ?? '';
	}

	// --- projects --------------------------------------------------------

	private async openProject(folder: string, handoff: { sessionId?: string; prompt?: string }): Promise<void> {
		if (this.currentFolder && sameFolder(this.currentFolder, folder)) {
			await this.chatView.reveal();
			return;
		}
		if (handoff.sessionId || handoff.prompt) {
			await this.handoffs.set({ cwd: folder, ...handoff });
		}
		// An empty window turns into the project window; a project window
		// opens (or focuses) a separate window for the other project.
		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), {
			forceNewWindow: this.currentFolder !== undefined,
		});
	}

	private async pickFolder(): Promise<string | undefined> {
		const picked = await vscode.window.showOpenDialog({
			canSelectFolders: true,
			canSelectFiles: false,
			canSelectMany: false,
			openLabel: 'Open project',
			title: 'Which project is this conversation about?',
		});
		return picked?.[0]?.fsPath;
	}

	private resolveInProject(file: string): string {
		return path.isAbsolute(file) || !this.currentFolder ? file : path.join(this.currentFolder, file);
	}

	// --- state for the webviews ------------------------------------------

	private async listConversations(): Promise<ConversationSummary[]> {
		try {
			const sdk = await loadAgentSdk();
			return toConversations(await sdk.listSessions({ limit: 200 }));
		} catch (error) {
			this.output.error(`could not list conversations: ${error}`);
			return [];
		}
	}

	private async findConversation(id: string): Promise<ConversationSummary | undefined> {
		return (await this.listConversations()).find(c => c.id === id);
	}

	async refreshAll(): Promise<void> {
		await Promise.all([this.refreshHome(), this.postConversation()]);
	}

	async refreshHome(): Promise<void> {
		if (!this.homePanel.isOpen) {
			return;
		}
		const conversations = await this.listConversations();
		const state: HomeState = {
			conversations,
			projects: toProjects(conversations, this.currentFolder ? [this.currentFolder] : []),
			hasApiKey: await this.apiKeys.has(),
			currentProject: this.currentFolder,
		};
		this.homePanel.post({ type: 'home', state });
	}

	private async postConversation(): Promise<void> {
		const folder = this.currentFolder;
		const recent = folder && !this.conversation
			? (await this.listConversations()).filter(c => sameFolder(c.cwd, folder)).slice(0, 8)
			: [];
		const state: ConversationState = {
			conversationId: this.conversation?.id,
			title: this.title,
			projectName: folder ? folderName(folder) : '',
			items: this.conversation?.transcript.items ?? [],
			busy: this.conversation?.isBusy ?? false,
			hasApiKey: await this.apiKeys.has(),
			recent,
		};
		this.chatView.post({ type: 'conversation', state });
	}

	dispose(): void {
		this.replaceConversation(undefined);
		vscode.Disposable.from(...this.disposables).dispose();
	}
}
