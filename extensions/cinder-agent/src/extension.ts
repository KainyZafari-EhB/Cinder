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

	// Always on screen, so the way back to other conversations does not
	// depend on the chat view being open.
	const conversationsItem = vscode.window.createStatusBarItem('cinder.conversations', vscode.StatusBarAlignment.Left, 1000);
	conversationsItem.name = 'Cinder Conversations';
	conversationsItem.text = '$(comment-discussion) Conversations';
	conversationsItem.tooltip = 'Show the conversations in this project';
	conversationsItem.command = 'cinder.showConversations';
	conversationsItem.show();

	context.subscriptions.push(
		output,
		conversationsItem,
		controller,
		vscode.window.registerWebviewViewProvider(ChatView.viewId, controller.chatView, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.workspace.registerTextDocumentContentProvider(BEFORE_SCHEME, controller),
		vscode.commands.registerCommand('cinder.home', () => controller.showHome()),
		vscode.commands.registerCommand('cinder.newConversation', () => controller.newConversation()),
		vscode.commands.registerCommand('cinder.showConversations', () => controller.showConversations()),
		vscode.commands.registerCommand('cinder.setApiKey', () => apiKeys.prompt()),
		vscode.commands.registerCommand('cinder.clearApiKey', async () => {
			await apiKeys.clear();
			void vscode.window.showInformationMessage('Removed the Anthropic API key from Cinder.');
		}),
	);

	void controller.startup().catch(error => output.error(`startup failed: ${error}`));
}

export function deactivate(): void { }
