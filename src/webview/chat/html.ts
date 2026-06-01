import * as vscode from 'vscode';

const DEFAULT_WELCOME_MESSAGE =
	'What would you like to build today? Paste your requirements, errors, or related code; I will first read the project context and synchronize the current progress in the chat area, then give you the next actionable step.';

export function getChatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const naviCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'navi.css'));
	const chatCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat.css'));
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'chatApp.js'));
	return String.raw`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};" />
	<title>Navi Chat</title>
	<link rel="stylesheet" href="${naviCssUri}" />
	<link rel="stylesheet" href="${chatCssUri}" />
</head>
<body>
	<div id="chatHeader" class="chat-header">
		<button id="chatTitleBtn" class="chat-title-btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="sessionDrawer" title="Show conversations">
			<span id="chatTitle" class="chat-title">New Chat</span>
			<svg class="chat-title-chevron" width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
				<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
		<button id="headerNewChatBtn" class="navi-icon-btn" type="button" aria-label="New chat" title="New chat">
			<svg class="navi-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
				<path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
			</svg>
		</button>
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
					<button id="todoToggleBtn" class="section-toggle" type="button" aria-expanded="true" aria-label="Toggle TODO list">▾</button>
				</div>
				<div id="todoList" class="todo-list"></div>
			</div>
			<div id="composerPanel" class="composer">
				<div id="composerBody" class="composer-body">
					<textarea id="prompt" placeholder="Ask Navi anything" aria-label="Message Navi"></textarea>
					<div class="composer-actions">
						<button id="settingsBtn" class="navi-icon-btn" type="button" aria-label="Settings" title="Settings">
							<svg class="navi-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
								<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</button>
						<button id="sendBtn" class="composer-send" type="button" aria-label="Send" title="Send">
							<svg class="navi-icon icon-send" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<path d="M8 13V3.5M4 7l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
							<svg class="navi-icon icon-stop" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<rect x="4" y="4" width="8" height="8" rx="1.5"/>
							</svg>
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
	<div id="sessionDrawerOverlay" class="session-drawer-overlay"></div>
	<div id="sessionDrawer" class="session-drawer" role="dialog" aria-modal="true" aria-label="Conversations" aria-hidden="true">
		<div class="drawer-header">
			<span class="drawer-title">Sessions</span>
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
