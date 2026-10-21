import * as vscode from 'vscode';
import type { HostMessage, ViewMessage } from '../protocol';
import { webviewHtml, webviewOptions } from './webviewHtml';

export interface Surface {
	post(message: HostMessage): void;
}

type Handler = (message: ViewMessage, surface: Surface) => void;

/** The conversation view in the secondary side bar. */
export class ChatView implements vscode.WebviewViewProvider, Surface {
	static readonly viewId = 'cinder.chat';
	private view: vscode.WebviewView | undefined;

	constructor(private readonly extensionUri: vscode.Uri, private readonly onMessage: Handler) { }

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = webviewOptions(this.extensionUri);
		view.webview.html = webviewHtml(view.webview, this.extensionUri, 'chat');
		view.webview.onDidReceiveMessage((message: ViewMessage) => this.onMessage(message, this));
		view.onDidDispose(() => (this.view = undefined));
	}

	post(message: HostMessage): void {
		void this.view?.webview.postMessage(message);
	}

	async reveal(): Promise<void> {
		await vscode.commands.executeCommand(`${ChatView.viewId}.focus`);
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
