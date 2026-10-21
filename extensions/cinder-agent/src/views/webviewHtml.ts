import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export type WebviewMode = 'home' | 'chat';

export function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
	return {
		enableScripts: true,
		localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist'), vscode.Uri.joinPath(extensionUri, 'media')],
	};
}

export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, mode: WebviewMode): string {
	const nonce = randomBytes(16).toString('base64');
	const asset = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...parts)).toString();
	const csp = [
		`default-src 'none'`,
		`style-src ${webview.cspSource}`,
		`font-src ${webview.cspSource}`,
		`img-src ${webview.cspSource} data:`,
		`script-src 'nonce-${nonce}'`,
	].join('; ');

	return `<!DOCTYPE html>
<html lang="en" data-mode="${mode}">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${asset('media', 'fonts.css')}">
	<link rel="stylesheet" href="${asset('dist', 'webview.css')}">
	<title>Cinder</title>
</head>
<body>
	<div id="app" data-mark="${asset('media', 'mark.svg')}"></div>
	<script nonce="${nonce}" src="${asset('dist', 'webview.js')}"></script>
</body>
</html>`;
}
