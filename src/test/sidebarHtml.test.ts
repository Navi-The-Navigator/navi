import * as assert from 'assert';
import * as vscode from 'vscode';
import { getSidebarHtml } from '../webview/sidebarHtml.js';

suite('getSidebarHtml', () => {
	test('renders the expected shell, stylesheet, and CSP nonce', () => {
		const webview = {
			cspSource: 'vscode-webview://test-source',
			asWebviewUri: (uri: vscode.Uri) => vscode.Uri.parse(`webview:${uri.path}`)
		} as unknown as vscode.Webview;
		const extensionUri = vscode.Uri.file('/tmp/navi-extension');

		const html = getSidebarHtml(webview, extensionUri);
		assert.ok(html.includes('<title>Navi Chat</title>'));
		assert.ok(
			html.includes(
				'你今天想构建什么？直接贴需求、报错或相关代码；我会先读取项目上下文，并在聊天区实时同步当前进度，再给你可立即执行的下一步。'
			)
		);
		assert.ok(html.includes('id="todoPanel"'));
		assert.ok(!html.includes('id="focusTargetSlot"'));
		assert.ok(html.includes('id="toolCallSlot"'));
		assert.ok(html.includes('id="composerShell"'));
		assert.ok(html.includes('id="todoToggleBtn"'));
		assert.ok(html.includes('class="todo-list"'));
		assert.ok(!html.includes('id="reviewBtn"'));
		assert.ok(!html.includes('function renderFocusTarget(target)'));
		assert.ok(!html.includes("type: 'chat:revealFocusTarget'"));
		assert.ok(!html.includes("if (message.type === 'chat:focusTarget')"));
		assert.ok(html.includes('webview:/tmp/navi-extension/media/sidebar.css'));
		assert.ok(html.includes('webview:/tmp/navi-extension/dist/sidebarApp.js'));
		assert.ok(html.includes('style-src vscode-webview://test-source; script-src vscode-webview://test-source;'));
		assert.ok(html.includes('<script src="webview:/tmp/navi-extension/dist/sidebarApp.js"></script>'));
	});
});
