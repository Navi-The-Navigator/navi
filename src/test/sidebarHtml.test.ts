import * as assert from 'assert';
import * as vscode from 'vscode';
import { getSidebarHtml } from '../webview/sidebarHtml';

suite('getSidebarHtml', () => {
	test('renders the expected shell, stylesheet, and CSP nonce', () => {
		const webview = {
			cspSource: 'vscode-webview://test-source',
			asWebviewUri: (uri: vscode.Uri) => vscode.Uri.parse(`webview:${uri.path}`)
		} as unknown as vscode.Webview;
		const extensionUri = vscode.Uri.file('/tmp/navi-extension');

		const html = getSidebarHtml(webview, extensionUri);
		const nonceMatch = html.match(/script-src 'nonce-([^']+)'/);

		assert.ok(nonceMatch);
		assert.ok(html.includes('<title>Navi Chat</title>'));
		assert.ok(html.includes('acquireVsCodeApi()'));
		assert.ok(html.includes('你好，我是 Navi。你可以直接描述需求、贴报错或让我改代码。'));
		assert.ok(html.includes('webview:/tmp/navi-extension/media/sidebar.css'));
		assert.ok(html.includes("style-src vscode-webview://test-source; script-src 'nonce-"));
		assert.ok(html.includes(`<script nonce="${nonceMatch?.[1]}">`));
		assert.ok(html.includes("vscode.postMessage({ type: 'chat:ready' });"));
	});
});