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
		assert.ok(
			html.includes(
				'你今天想构建什么？直接贴需求、报错或相关代码；我会先读取项目上下文，并在聊天区实时同步当前进度，再给你可立即执行的下一步。'
			)
		);
		assert.ok(html.includes('id="todoPanel"'));
		assert.ok(html.includes('id="toolCallSlot"'));
		assert.ok(html.includes('id="composerShell"'));
		assert.ok(html.includes('id="todoToggleBtn"'));
		assert.ok(html.includes('class="todo-list"'));
		assert.ok(html.includes('id="reviewBtn"'));
		assert.ok(html.includes("type: 'chat:cancelGeneration'"));
		assert.ok(html.includes("join('\\\\n')"));
		assert.ok(html.includes("if (message.type === 'chat:todos')"));
		assert.ok(html.includes("chatBody.querySelectorAll('.tool-status').forEach((node) => node.remove());"));
		assert.ok(html.includes('let transientToolStatusEl = null;'));
		assert.ok(html.includes('let transientToolStatusHideTimeout = null;'));
		assert.ok(html.includes('let progressCollapseFinalizeTimeout = null;'));
		assert.ok(html.includes("const toolCallSlot = document.getElementById('toolCallSlot');"));
		assert.ok(html.includes('let progressSummaryEl = null;'));
		assert.ok(html.includes('function appendTransientToolStatus(text)'));
		assert.ok(html.includes('function fadeTransientToolStatus()'));
		assert.ok(html.includes('}, 1500);'));
		assert.ok(html.includes('function setProgressCollapsed(collapsed)'));
		assert.ok(html.includes("node.classList.add('progress-collapsed-done');"));
		assert.ok(html.includes("node.style.display = '';"));
		assert.ok(html.includes("node.style.display = 'none';"));
		assert.ok(html.includes('function refreshProgressSummary()'));
		assert.ok(html.includes('function keepTransientToolStatusAtBottom()'));
		assert.ok(html.includes('chatBody.insertBefore(toolCallSlot, loading);'));
		assert.ok(html.includes('function setTodoCollapsed(collapsed)'));
		assert.ok(html.includes("todoToggleBtn.textContent = (todoCollapsed ? '▸' : '▾') + ' TODO';"));
		assert.ok(html.includes("el.className = 'tool-status progress-entry';"));
		assert.ok(html.includes("el.classList.add('progress-entry-appear');"));
		assert.ok(html.includes("el.className = 'tool-status elapsed-status';"));
		assert.ok(html.includes('chatBody.insertBefore(el, toolCallSlot);'));
		assert.ok(html.includes(".filter((node) => !node.classList.contains('elapsed-status'));"));
		assert.ok(html.includes('setTodoCollapsed(false);'));
		assert.ok(html.includes("toolCallSlot.classList.add('hidden');"));
		assert.ok(html.includes("appendToolStatus(message.text || '', !!message.transient);"));
		assert.ok(html.includes('function clearTransientToolStatus()'));
		assert.ok(html.includes("if (message.type === 'chat:toolStatusDone')"));
		assert.ok(html.includes('setProgressCollapsed(true);'));
		assert.ok(html.includes('function renderMarkdown(raw)'));
		assert.ok(html.includes('const codeTokenPattern = /^@@(?:MDCODE)(\\d+)@@$/;'));
		assert.ok(html.includes("const normalizedForBlocks = withCodeTokens.replace(/(@@MDCODE\\d+@@)/g, '\\n\\n$1\\n\\n');"));
		assert.ok(html.includes("const token = '@@MDLINK' + links.length + '@@';"));
		assert.ok(html.includes("activeAssistantMessage.innerHTML = renderMarkdown(nextRaw);"));
		assert.ok(html.includes("el.dataset.rawMarkdown = text || '';"));
		assert.ok(html.includes("el.innerHTML = renderMarkdown(text || '');"));
		assert.ok(html.includes('webview:/tmp/navi-extension/media/sidebar.css'));
		assert.ok(html.includes("style-src vscode-webview://test-source; script-src 'nonce-"));
		assert.ok(html.includes(`<script nonce="${nonceMatch?.[1]}">`));
		assert.ok(html.includes("vscode.postMessage({ type: 'chat:ready' });"));
	});
});
