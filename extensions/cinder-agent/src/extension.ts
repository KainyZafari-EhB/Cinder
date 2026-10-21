import * as vscode from 'vscode';
import { ApiKeyStore } from './apiKey';
import { BEFORE_SCHEME, Controller } from './controller';
import { HandoffStore } from './handoff';
import { ChatView, HomePanel } from './views/surfaces';

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Cinder', { log: true });
	const apiKeys = new ApiKeyStore(context.secrets);
	const controller = new Controller(apiKeys, new HandoffStore(context.globalState), output);
	controller.chatView = new ChatView(context.extensionUri, controller.handleMessage);
	controller.homePanel = new HomePanel(context.extensionUri, controller.handleMessage);

	context.subscriptions.push(
		output,
		controller,
		vscode.window.registerWebviewViewProvider(ChatView.viewId, controller.chatView, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.workspace.registerTextDocumentContentProvider(BEFORE_SCHEME, controller),
		vscode.commands.registerCommand('cinder.home', () => controller.showHome()),
		vscode.commands.registerCommand('cinder.newConversation', () => controller.newConversation()),
		vscode.commands.registerCommand('cinder.setApiKey', () => apiKeys.prompt()),
		vscode.commands.registerCommand('cinder.clearApiKey', async () => {
			await apiKeys.clear();
			void vscode.window.showInformationMessage('Removed the Anthropic API key from Cinder.');
		}),
	);

	void controller.startup().catch(error => output.error(`startup failed: ${error}`));
}

export function deactivate(): void { }
