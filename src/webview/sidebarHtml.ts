import * as vscode from 'vscode';

const DEFAULT_WELCOME_MESSAGE =
	'What would you like to build today? Paste your requirements, errors, or related code; I will first read the project context and synchronize the current progress in the chat area, then give you the next actionable step.';

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
	<div id="chatHeader" class="chat-header">
		<span id="chatTitle" class="chat-title">New Chat</span>
	</div>
	<div class="chat-body" id="chatBody">
		<div class="message assistant"><p>${DEFAULT_WELCOME_MESSAGE}</p></div>
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
	<div id="sessionDrawerOverlay" class="session-drawer-overlay"></div>
	<div id="sessionDrawer" class="session-drawer" aria-label="Conversations">
		<div class="drawer-header">
			<span class="drawer-title">Sessions</span>
			<button id="drawerNewChatBtn" class="drawer-new-chat-btn" type="button">+ New Chat</button>
		</div>
		<div class="drawer-search-wrap">
			<input id="drawerSearch" class="drawer-search" type="text" placeholder="Search sessions…" autocomplete="off" />
		</div>
		<div id="sessionList" class="session-list"></div>
	</div>
	<script src="${scriptUri}"></script>
</body>
</html>`;
	}


