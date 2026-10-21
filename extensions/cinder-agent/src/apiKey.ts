import * as vscode from 'vscode';

const SECRET_KEY = 'cinder.anthropicApiKey';

/**
 * The Anthropic API key Cinder uses for Claude. Stored in VS Code's secret
 * storage (the OS keychain); ANTHROPIC_API_KEY in the environment also works.
 */
export class ApiKeyStore {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;

	constructor(private readonly secrets: vscode.SecretStorage) {
		secrets.onDidChange(event => {
			if (event.key === SECRET_KEY) {
				this.changed.fire();
			}
		});
	}

	async get(): Promise<string | undefined> {
		return (await this.secrets.get(SECRET_KEY)) || process.env.ANTHROPIC_API_KEY || undefined;
	}

	async has(): Promise<boolean> {
		return (await this.get()) !== undefined;
	}

	/** Asks for a key. Returns it, or undefined if the user cancelled. */
	async prompt(): Promise<string | undefined> {
		const key = await vscode.window.showInputBox({
			title: 'Anthropic API key',
			prompt: 'Cinder uses your own API key to talk to Claude. Create one in the Claude Console under API keys.',
			placeHolder: 'sk-ant-…',
			password: true,
			ignoreFocusOut: true,
			validateInput: value => (value.trim().startsWith('sk-ant-') ? undefined : 'Anthropic API keys start with "sk-ant-".'),
		});
		if (!key) {
			return undefined;
		}
		await this.secrets.store(SECRET_KEY, key.trim());
		return key.trim();
	}

	async clear(): Promise<void> {
		await this.secrets.delete(SECRET_KEY);
	}

	/** Returns a key, asking for one first if none is set. */
	async require(): Promise<string | undefined> {
		return (await this.get()) ?? (await this.prompt());
	}
}
