import * as vscode from 'vscode';
import type { HostMessage, ViewMessage } from '../protocol';
import { webviewHtml, webviewOptions } from './webviewHtml';

export interface Surface {
	post(message: HostMessage): void;
}

type Handler = (message: ViewMessage, surface: Surface) => void;

/**
 * The conversation, shown as an editor tab so it gets the whole editor area.
 * Claude's changes open as diffs beside it.
 */
export class ChatPanel implements vscode.WebviewPanelSerializer, Surface {
	static readonly viewType = 'cinder.chat';
	private panel: vscode.WebviewPanel | undefined;
	private title = 'Conversation';

	constructor(private readonly extensionUri: vscode.Uri, private readonly onMessage: Handler) { }

	get isResolved(): boolean {
		return this.panel !== undefined;
	}

	get viewColumn(): vscode.ViewColumn | undefined {
		return this.panel?.viewColumn;
	}

	/** True when this window already has a chat tab, open or waiting to be restored. */
	static hasTab(): boolean {
		return vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
			tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(ChatPanel.viewType)));
	}

	async reveal(): Promise<void> {
		if (this.panel) {
			this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.One);
			return;
		}
		this.adopt(vscode.window.createWebviewPanel(ChatPanel.viewType, this.title, vscode.ViewColumn.One, {
			...webviewOptions(this.extensionUri),
			retainContextWhenHidden: true,
		}));
	}

	/** Restores the chat tab after a window reload. */
	async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
		if (this.panel) {
			panel.dispose();
			return;
		}
		this.adopt(panel);
	}

	setTitle(title: string): void {
		this.title = title;
		if (this.panel) {
			this.panel.title = title;
		}
	}

	post(message: HostMessage): void {
		void this.panel?.webview.postMessage(message);
	}

	private adopt(panel: vscode.WebviewPanel): void {
		this.panel = panel;
		panel.title = this.title;
		panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'mark.svg');
		panel.webview.options = webviewOptions(this.extensionUri);
		panel.webview.html = webviewHtml(panel.webview, this.extensionUri, 'chat');
		panel.webview.onDidReceiveMessage((message: ViewMessage) => this.onMessage(message, this));
		panel.onDidDispose(() => (this.panel = undefined));
	}
}

/** The home screen, shown as a full editor tab. */
export class HomePanel implements Surface {
	private panel: vscode.WebviewPanel | undefined;

	constructor(private readonly extensionUri: vscode.Uri, private readonly onMessage: Handler) { }

	get isOpen(): boolean {
		return this.panel !== undefined;
	}

	show(): void {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One);
			return;
		}
		this.panel = vscode.window.createWebviewPanel('cinder.home', 'Home', vscode.ViewColumn.One, {
			...webviewOptions(this.extensionUri),
			retainContextWhenHidden: true,
		});
		this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'mark.svg');
		this.panel.webview.html = webviewHtml(this.panel.webview, this.extensionUri, 'home');
		this.panel.webview.onDidReceiveMessage((message: ViewMessage) => this.onMessage(message, this));
		this.panel.onDidDispose(() => (this.panel = undefined));
	}

	close(): void {
		this.panel?.dispose();
	}

	post(message: HostMessage): void {
		void this.panel?.webview.postMessage(message);
	}
}
