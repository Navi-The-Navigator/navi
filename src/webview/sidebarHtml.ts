import * as vscode from 'vscode';

const DEFAULT_WELCOME_MESSAGE =
	'你今天想构建什么？直接贴需求、报错或相关代码；我会先读取项目上下文，并在聊天区实时同步当前进度，再给你可立即执行的下一步。';

export function getSidebarHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.css'));
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'sidebarApp.js'));
	return String.raw`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};" />
	<title>Navi Chat</title>
	<link rel="stylesheet" href="${stylesUri}" />
</head>
<body>
	<div class="chat-header">
		<div class="chat-header-main">
			<div class="chat-dot"></div>
			<div>
				<div class="chat-title">Navi Chat</div>
			</div>
		</div>
		<div class="chat-header-right">
			<div id="activeSessionLabel" class="chat-session-title">New Chat</div>
			<div class="chat-chevron">▶</div>
		</div>
	</div>
	<div id="sessionDropdown" class="session-dropdown"></div>
	<div class="chat-body" id="chatBody">
		<div class="message assistant">${DEFAULT_WELCOME_MESSAGE}</div>
		<div id="toolCallSlot" class="tool-call-slot" aria-live="polite"></div>
		<div class="loading" id="loading">Navi is thinking...</div>
	</div>
	<div class="chat-footer">
		<div id="composerShell" class="composer-shell">
			<div id="todoPanel" class="todo-panel">
				<div class="todo-header">
					<div class="todo-title-wrap">
						<span class="todo-title">TODO</span>
						<span id="todoSummary" class="todo-summary"></span>
					</div>
					<button id="todoToggleBtn" class="section-toggle" type="button" aria-expanded="true">折叠</button>
				</div>
				<div id="todoList" class="todo-list"></div>
			</div>
			<div id="composerPanel" class="composer">
				<div class="composer-header">
					<span class="composer-title">输入</span>
				</div>
				<div id="composerBody" class="composer-body">
					<textarea id="prompt" placeholder="Ask Navi anything"></textarea>
					<div class="composer-actions">
						<button id="settingsBtn" class="composer-secondary" type="button">Settings</button>
						<button id="sendBtn" class="composer-send" type="button">Send</button>
					</div>
				</div>
			</div>
		</div>
	</div>
	<script src="${scriptUri}"></script>
</body>
</html>`;
	}


