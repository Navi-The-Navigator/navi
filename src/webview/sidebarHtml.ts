import * as vscode from 'vscode';
import { getNonce } from '../utils/id';

export function getSidebarHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const nonce = getNonce();
	const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.css'));
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
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
		<div class="message assistant">你好，我是 Navi。你可以直接描述需求、贴报错或让我改代码。</div>
		<div class="loading" id="loading">Navi is thinking...</div>
	</div>
	<div class="chat-footer">
		<div class="composer">
			<textarea id="prompt" placeholder="Ask Navi anything"></textarea>
			<div class="composer-actions">
				<button id="sendBtn" class="composer-send" type="button">Send</button>
			</div>
		</div>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const chatHeader = document.querySelector('.chat-header');
		const chatBody = document.getElementById('chatBody');
		const promptInput = document.getElementById('prompt');
		const sendBtn = document.getElementById('sendBtn');
		const sessionDropdown = document.getElementById('sessionDropdown');
		const activeSessionLabel = document.getElementById('activeSessionLabel');
		const chatChevron = document.querySelector('.chat-chevron');
		const loading = document.getElementById('loading');
		let activeAssistantMessage = null;
		let currentSessionId = '';
		let isBusy = false;
		let sessionsState = [];
		let editingSessionId = '';
		let startAckTimeout = null;

		function setLoading(isLoading) {
			isBusy = isLoading;
			if (isLoading && startAckTimeout) {
				clearTimeout(startAckTimeout);
				startAckTimeout = null;
			}
			if (isLoading) {
				loading.classList.add('show');
				sendBtn.disabled = true;
				closeSessionDropdown();
			} else {
				loading.classList.remove('show');
				sendBtn.disabled = false;
			}
		}

		function appendMessage(role, text) {
			const el = document.createElement('div');
			el.className = 'message ' + role;
			el.textContent = text;
			chatBody.insertBefore(el, loading);
			chatBody.scrollTop = chatBody.scrollHeight;
			return el;
		}

		function autoResizePrompt() {
			promptInput.style.height = 'auto';
			const maxHeight = 120;
			const nextHeight = Math.min(promptInput.scrollHeight, maxHeight);
			promptInput.style.height = nextHeight + 'px';
			promptInput.style.overflowY = promptInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
		}

		function startAssistantMessage() {
			if (!activeAssistantMessage) {
				activeAssistantMessage = appendMessage('assistant', '');
			}
		}

		function appendAssistantDelta(text) {
			startAssistantMessage();
			activeAssistantMessage.textContent += text;
			chatBody.scrollTop = chatBody.scrollHeight;
		}

		function finishAssistantMessage() {
			if (!activeAssistantMessage) {
				appendMessage('assistant', '我暂时没有生成可显示的文本响应。');
				setLoading(false);
				return;
			}
			if (!activeAssistantMessage.textContent.trim()) {
				activeAssistantMessage.textContent = '我暂时没有生成可显示的文本响应。';
			}
			activeAssistantMessage = null;
			setLoading(false);
		}

		function resetChat() {
			chatBody.querySelectorAll('.message').forEach((node) => node.remove());
			appendMessage('assistant', '你好，我是 Navi。你可以直接描述需求、贴报错或让我改代码。');
			activeAssistantMessage = null;
			setLoading(false);
		}

		function sendMessage() {
			const text = promptInput.value.trim();
			if (!text || sendBtn.disabled || isBusy) {
				return;
			}

			appendMessage('user', text);
			promptInput.value = '';
			autoResizePrompt();
			vscode.postMessage({ type: 'chat:userMessage', text });
			if (startAckTimeout) {
				clearTimeout(startAckTimeout);
			}
			startAckTimeout = setTimeout(() => {
				if (!isBusy) {
					appendMessage('assistant', '请求未被处理，请重试一次。');
				}
			}, 5000);
		}

		function openSessionDropdown() {
			sessionDropdown.classList.add('show');
			chatChevron.classList.add('open');
		}

		function closeSessionDropdown() {
			sessionDropdown.classList.remove('show');
			chatChevron.classList.remove('open');
			editingSessionId = '';
		}

		function toggleSessionDropdown() {
			if (sessionDropdown.classList.contains('show')) {
				closeSessionDropdown();
				return;
			}
			openSessionDropdown();
		}

		function renderSessions(sessions, activeSessionId) {
			sessionsState = Array.isArray(sessions) ? sessions : [];
			sessionDropdown.innerHTML = '';
			currentSessionId = activeSessionId || '';

			sessionsState.forEach((session) => {
				const row = document.createElement('div');
				row.className = 'session-card' + (session.id === currentSessionId ? ' active' : '');

				if (editingSessionId === session.id) {
					const input = document.createElement('input');
					input.type = 'text';
					input.className = 'session-inline-input';
					input.value = session.title || 'New Chat';
					input.maxLength = 60;
					row.appendChild(input);

					const toolWrap = document.createElement('div');
					toolWrap.className = 'session-item-tools';

					const saveBtn = document.createElement('button');
					saveBtn.type = 'button';
					saveBtn.className = 'session-tool primary';
					saveBtn.textContent = 'Save';
					saveBtn.addEventListener('click', () => {
						if (isBusy) {
							return;
						}
						const title = input.value.trim();
						if (!title) {
							input.focus();
							return;
						}
						editingSessionId = '';
						vscode.postMessage({ type: 'chat:renameSession', sessionId: session.id, title });
					});

					const cancelBtn = document.createElement('button');
					cancelBtn.type = 'button';
					cancelBtn.className = 'session-tool';
					cancelBtn.textContent = 'Cancel';
					cancelBtn.addEventListener('click', () => {
						editingSessionId = '';
						renderSessions(sessionsState, currentSessionId);
					});

					input.addEventListener('keydown', (event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							saveBtn.click();
						}
						if (event.key === 'Escape') {
							event.preventDefault();
							cancelBtn.click();
						}
					});

					toolWrap.appendChild(saveBtn);
					toolWrap.appendChild(cancelBtn);
					row.appendChild(toolWrap);
					sessionDropdown.appendChild(row);
					setTimeout(() => input.focus(), 0);
					return;
				}

				const item = document.createElement('button');
				item.type = 'button';
				item.className = 'session-card-main';
				item.textContent = session.title || 'New Chat';
				item.addEventListener('click', () => {
					if (isBusy || !session.id || session.id === currentSessionId) {
						return;
					}
					closeSessionDropdown();
					vscode.postMessage({ type: 'chat:switchSession', sessionId: session.id });
				});

				const toolWrap = document.createElement('div');
				toolWrap.className = 'session-item-tools';

				const renameBtn = document.createElement('button');
				renameBtn.type = 'button';
				renameBtn.className = 'session-tool';
				renameBtn.textContent = 'Rename';
				renameBtn.addEventListener('click', () => {
					if (isBusy || !session.id) {
						return;
					}
					editingSessionId = session.id;
					renderSessions(sessionsState, currentSessionId);
				});

				const deleteBtn = document.createElement('button');
				deleteBtn.type = 'button';
				deleteBtn.className = 'session-tool';
				deleteBtn.textContent = 'Delete';
				deleteBtn.addEventListener('click', () => {
					if (isBusy || !session.id) {
						return;
					}
					vscode.postMessage({ type: 'chat:deleteSession', sessionId: session.id });
				});

				toolWrap.appendChild(renameBtn);
				toolWrap.appendChild(deleteBtn);
				row.appendChild(item);
				row.appendChild(toolWrap);
				sessionDropdown.appendChild(row);
			});

			const divider = document.createElement('div');
			divider.className = 'session-divider';
			sessionDropdown.appendChild(divider);

			const newChatAction = document.createElement('button');
			newChatAction.type = 'button';
			newChatAction.className = 'session-new-chat';
			newChatAction.textContent = '+ New Chat';
			newChatAction.addEventListener('click', () => {
				if (isBusy) {
					return;
				}
				closeSessionDropdown();
				vscode.postMessage({ type: 'chat:newSession' });
			});
			sessionDropdown.appendChild(newChatAction);

			const active = sessions.find((session) => session.id === currentSessionId);
			activeSessionLabel.textContent = (active && active.title) || 'New Chat';
		}

		function renderSessionHistory(messages) {
			resetChat();
			if (!Array.isArray(messages) || messages.length === 0) {
				return;
			}

			chatBody.querySelectorAll('.message').forEach((node) => node.remove());
			messages.forEach((message) => {
				appendMessage(message.role === 'user' ? 'user' : 'assistant', message.text || '');
			});
		}

		function appendToolStatus(text) {
			const el = document.createElement('div');
			el.className = 'tool-status';
			el.textContent = text;
			chatBody.insertBefore(el, loading);
			activeAssistantMessage = null;
			chatBody.scrollTop = chatBody.scrollHeight;
		}

		function appendElapsedStatus(text) {
			const el = document.createElement('div');
			el.className = 'tool-status elapsed-status';
			el.textContent = text;
			chatBody.insertBefore(el, loading);
			chatBody.scrollTop = chatBody.scrollHeight;
		}

		sendBtn.addEventListener('click', sendMessage);
		chatHeader.addEventListener('click', (event) => {
			if (isBusy) {
				return;
			}
			event.stopPropagation();
			toggleSessionDropdown();
		});
		sessionDropdown.addEventListener('click', (event) => {
			event.stopPropagation();
		});
		document.addEventListener('click', () => {
			closeSessionDropdown();
		});
		document.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape') {
				return;
			}
			closeSessionDropdown();
		});

		promptInput.addEventListener('keydown', (event) => {
			if (event.isComposing) {
				return;
			}
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				sendMessage();
			}
		});
		promptInput.addEventListener('input', autoResizePrompt);
		autoResizePrompt();

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message.type === 'chat:assistantStart') {
				activeAssistantMessage = null;
				setLoading(true);
			}
			if (message.type === 'chat:assistantDelta') {
				appendAssistantDelta(message.text || '');
			}
			if (message.type === 'chat:assistantDone') {
				finishAssistantMessage();
			}
			if (message.type === 'chat:toolStatus') {
				appendToolStatus(message.text || '');
			}
			if (message.type === 'chat:elapsed') {
				appendElapsedStatus(message.text || '');
			}
			if (message.type === 'chat:error') {
				if (activeAssistantMessage && !activeAssistantMessage.textContent.trim()) {
					activeAssistantMessage.textContent = message.text || '请求失败';
				} else {
					appendMessage('assistant', message.text || '请求失败');
				}
				setLoading(false);
			}
			if (message.type === 'chat:sessionReset') {
				resetChat();
			}
			if (message.type === 'chat:sessions') {
				renderSessions(message.sessions || [], message.currentSessionId || '');
			}
			if (message.type === 'chat:sessionHistory') {
				if (message.sessionId === currentSessionId) {
					renderSessionHistory(message.messages || []);
				}
			}
		});
		vscode.postMessage({ type: 'chat:ready' });
	</script>
</body>
</html>`;
	}


