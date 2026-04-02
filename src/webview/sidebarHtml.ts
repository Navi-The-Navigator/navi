import * as vscode from 'vscode';
import { getNonce } from '../utils/id';

const DEFAULT_WELCOME_MESSAGE =
	'你今天想构建什么？直接贴需求、报错或相关代码；我会先读取项目上下文，并在聊天区实时同步当前进度，再给你可立即执行的下一步。';

export function getSidebarHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const nonce = getNonce();
	const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.css'));
	return String.raw`<!DOCTYPE html>
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
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const chatHeader = document.querySelector('.chat-header');
		const chatBody = document.getElementById('chatBody');
		const promptInput = document.getElementById('prompt');
		const settingsBtn = document.getElementById('settingsBtn');
		const sendBtn = document.getElementById('sendBtn');
		const composerShell = document.getElementById('composerShell');
		const todoPanel = document.getElementById('todoPanel');
		const todoToggleBtn = document.getElementById('todoToggleBtn');
		const todoList = document.getElementById('todoList');
		const todoSummary = document.getElementById('todoSummary');
		const sessionDropdown = document.getElementById('sessionDropdown');
		const activeSessionLabel = document.getElementById('activeSessionLabel');
		const chatChevron = document.querySelector('.chat-chevron');
		const toolCallSlot = document.getElementById('toolCallSlot');
		const loading = document.getElementById('loading');
		let activeAssistantMessage = null;
		let currentSessionId = '';
		let isBusy = false;
		let sessionsState = [];
		let todosState = [];
		let editingSessionId = '';
		let startAckTimeout = null;
		let transientToolStatusEl = null;
		let transientToolStatusHideTimeout = null;
		let progressCollapseFinalizeTimeout = null;
		let progressSummaryEl = null;
		let progressCollapsed = false;
		let todoCollapsed = false;
		const mdBacktick = String.fromCharCode(96);
		const inlineCodePattern = new RegExp(mdBacktick + '([^' + mdBacktick + '\\n]+)' + mdBacktick, 'g');
		const fence = mdBacktick + mdBacktick + mdBacktick;
		const codeFencePattern = new RegExp(fence + '([\\w-]*)\\n?([\\s\\S]*?)' + fence, 'g');
		const codeTokenPattern = /^@@(?:MDCODE)(\d+)@@$/;
		const TODO_BOTTOM_STICKY_THRESHOLD_PX = 120;

		function setLoading(isLoading) {
			isBusy = isLoading;
			if (isLoading && startAckTimeout) {
				clearTimeout(startAckTimeout);
				startAckTimeout = null;
			}
			if (isLoading) {
				toolCallSlot.classList.remove('hidden');
				loading.classList.add('show');
				sendBtn.disabled = false;
				sendBtn.textContent = 'Cancel';
				sendBtn.classList.add('composer-cancel');
				settingsBtn.disabled = true;
				closeSessionDropdown();
			} else {
				loading.classList.remove('show');
				toolCallSlot.classList.add('hidden');
				sendBtn.disabled = false;
				sendBtn.textContent = 'Send';
				sendBtn.classList.remove('composer-cancel');
				settingsBtn.disabled = false;
			}
		}

		function appendMessage(role, text) {
			const el = document.createElement('div');
			el.className = 'message ' + role;
			el.dataset.rawMarkdown = text || '';
			el.innerHTML = renderMarkdown(text || '');
			chatBody.insertBefore(el, toolCallSlot);
			chatBody.scrollTop = chatBody.scrollHeight;
			return el;
		}

		function escapeHtml(text) {
			return (text || '')
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}

		function sanitizeHref(href) {
			const raw = (href || '').trim();
			if (!raw) {
				return '';
			}
			if (raw.startsWith('#')) {
				return raw;
			}
			try {
				const parsed = new URL(raw, 'https://example.invalid');
				if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
					return raw;
				}
				return '';
			} catch {
				return '';
			}
		}

		function renderInlineMarkdown(raw) {
			const links = [];
			const withLinkTokens = (raw || '').replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_, label, href) => {
				const safeHref = sanitizeHref(href);
				if (!safeHref) {
					return label;
				}
				const token = '@@MDLINK' + links.length + '@@';
				links.push(
					'<a href="' +
						escapeHtml(safeHref) +
						'" target="_blank" rel="noopener noreferrer">' +
						escapeHtml(label) +
						'</a>'
				);
				return token;
			});

			let html = escapeHtml(withLinkTokens)
				.replace(inlineCodePattern, '<code>$1</code>')
				.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
				.replace(/__([^_]+)__/g, '<strong>$1</strong>')
				.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
				.replace(/_([^_\n]+)_/g, '<em>$1</em>');

			links.forEach((linkHtml, index) => {
				const token = '@@MDLINK' + index + '@@';
				html = html.split(token).join(linkHtml);
			});

			return html;
		}

		function renderMarkdown(raw) {
			const source = (raw || '').replace(/\r\n/g, '\n');
			if (!source.trim()) {
				return '';
			}

			const codeBlocks = [];
			const withCodeTokens = source.replace(codeFencePattern, (_, lang, code) => {
				const token = '@@MDCODE' + codeBlocks.length + '@@';
				const language = (lang || '').trim();
				const classAttr = language ? ' class="language-' + escapeHtml(language) + '"' : '';
				codeBlocks.push('<pre class="md-pre"><code' + classAttr + '>' + escapeHtml(code) + '</code></pre>');
				return token;
			});

			const normalizedForBlocks = withCodeTokens.replace(/(@@MDCODE\d+@@)/g, '\n\n$1\n\n');

			const blocks = normalizedForBlocks
				.split(/\n{2,}/)
				.map((block) => block.trim())
				.filter((block) => block.length > 0);

			const html = blocks.map((block) => {
				const codeTokenMatch = block.match(codeTokenPattern);
				if (codeTokenMatch) {
					const index = Number(codeTokenMatch[1]);
					return codeBlocks[index] || '';
				}

				if (/^#{1,6}\s+/.test(block)) {
					const headingMatch = block.match(/^(#{1,6})\s+([\s\S]*)$/);
					if (!headingMatch) {
						return '<p>' + renderInlineMarkdown(block.replace(/\n/g, '<br />')) + '</p>';
					}
					const level = headingMatch[1].length;
					const text = headingMatch[2].trim();
					return '<h' + level + '>' + renderInlineMarkdown(text) + '</h' + level + '>';
				}

				const quoteLines = block.split('\n');
				if (quoteLines.every((line) => /^>\s?/.test(line))) {
					const quoteText = quoteLines.map((line) => line.replace(/^>\s?/, '')).join('\n');
					return '<blockquote>' + renderInlineMarkdown(quoteText).replace(/\n/g, '<br />') + '</blockquote>';
				}

				const unordered = block
					.split('\n')
					.map((line) => line.trim())
					.filter((line) => line.length > 0);
				if (unordered.length > 0 && unordered.every((line) => /^[-*+]\s+/.test(line))) {
					const items = unordered
						.map((line) => '<li>' + renderInlineMarkdown(line.replace(/^[-*+]\s+/, '')) + '</li>')
						.join('');
					return '<ul>' + items + '</ul>';
				}

				const ordered = block
					.split('\n')
					.map((line) => line.trim())
					.filter((line) => line.length > 0);
				if (ordered.length > 0 && ordered.every((line) => /^\d+\.\s+/.test(line))) {
					const items = ordered
						.map((line) => '<li>' + renderInlineMarkdown(line.replace(/^\d+\.\s+/, '')) + '</li>')
						.join('');
					return '<ol>' + items + '</ol>';
				}

				return '<p>' + renderInlineMarkdown(block).replace(/\n/g, '<br />') + '</p>';
			});

			return html.join('');
		}

		function autoResizePrompt() {
			promptInput.style.height = 'auto';
			const maxHeight = 120;
			const nextHeight = Math.min(promptInput.scrollHeight, maxHeight);
			promptInput.style.height = nextHeight + 'px';
			promptInput.style.overflowY = promptInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
		}

		function setTodoCollapsed(collapsed) {
			const distanceToBottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight;
			const shouldStickToBottom = distanceToBottom <= TODO_BOTTOM_STICKY_THRESHOLD_PX;
			todoCollapsed = !!collapsed;
			todoPanel.classList.toggle('collapsed', todoCollapsed);
			todoToggleBtn.textContent = (todoCollapsed ? '▸' : '▾') + ' TODO';
			todoToggleBtn.setAttribute('aria-expanded', String(!todoCollapsed));
			if (shouldStickToBottom) {
				requestAnimationFrame(() => {
					chatBody.scrollTop = chatBody.scrollHeight;
				});
			}
		}

		function startAssistantMessage() {
			if (!activeAssistantMessage) {
				activeAssistantMessage = appendMessage('assistant', '');
			}
		}

		function appendAssistantDelta(text) {
			startAssistantMessage();
			const nextRaw = (activeAssistantMessage.dataset.rawMarkdown || '') + text;
			activeAssistantMessage.dataset.rawMarkdown = nextRaw;
			activeAssistantMessage.innerHTML = renderMarkdown(nextRaw);
			chatBody.scrollTop = chatBody.scrollHeight;
		}

		function finishAssistantMessage() {
			if (!activeAssistantMessage) {
				appendMessage('assistant', '我暂时没有生成可显示的文本响应。');
				setLoading(false);
				return;
			}
			const raw = activeAssistantMessage.dataset.rawMarkdown || '';
			if (!raw.trim()) {
				const fallback = '我暂时没有生成可显示的文本响应。';
				activeAssistantMessage.dataset.rawMarkdown = fallback;
				activeAssistantMessage.innerHTML = renderMarkdown(fallback);
			}
			activeAssistantMessage = null;
			setLoading(false);
		}

		function resetChat() {
			chatBody.querySelectorAll('.message').forEach((node) => node.remove());
			chatBody.querySelectorAll('.tool-status').forEach((node) => node.remove());
			keepTransientToolStatusAtBottom();
			toolCallSlot.classList.add('empty');
			toolCallSlot.textContent = '';
			if (progressSummaryEl) {
				progressSummaryEl.remove();
				progressSummaryEl = null;
			}
			progressCollapsed = false;
			transientToolStatusEl = null;
			appendMessage('assistant', ${JSON.stringify(DEFAULT_WELCOME_MESSAGE)});
			activeAssistantMessage = null;
			setLoading(false);
		}

		function getProgressStatusNodes() {
			return Array.from(chatBody.querySelectorAll('.tool-status'))
				.filter((node) => !node.classList.contains('transient-tool-status'))
				.filter((node) => !node.classList.contains('elapsed-status'));
		}

		function keepTransientToolStatusAtBottom() {
			chatBody.insertBefore(toolCallSlot, loading);
		}

		function ensureProgressSummary() {
			if (progressSummaryEl) {
				return progressSummaryEl;
			}
			const summary = document.createElement('button');
			summary.type = 'button';
			summary.className = 'progress-summary';
			summary.addEventListener('click', () => {
				setProgressCollapsed(!progressCollapsed);
			});
			progressSummaryEl = summary;
			const firstProgressNode = getProgressStatusNodes()[0] ?? loading;
			chatBody.insertBefore(summary, firstProgressNode);
			return summary;
		}

		function setProgressCollapsed(collapsed) {
			progressCollapsed = !!collapsed;
			if (progressCollapseFinalizeTimeout) {
				clearTimeout(progressCollapseFinalizeTimeout);
				progressCollapseFinalizeTimeout = null;
			}
			const nodes = getProgressStatusNodes();
			if (!progressCollapsed) {
				nodes.forEach((node) => {
					node.classList.remove('progress-collapsed-done');
					node.style.display = '';
				});
				requestAnimationFrame(() => {
					nodes.forEach((node) => {
						node.classList.remove('progress-hidden');
					});
				});
			} else {
				nodes.forEach((node) => {
					node.classList.add('progress-hidden');
				});
				progressCollapseFinalizeTimeout = setTimeout(() => {
					if (!progressCollapsed) {
						return;
					}
					const activeNodes = getProgressStatusNodes();
					activeNodes.forEach((node) => {
						node.classList.add('progress-collapsed-done');
						node.style.display = 'none';
					});
				}, 240);
			}

			if (nodes.length === 0) {
				if (progressSummaryEl) {
					progressSummaryEl.remove();
					progressSummaryEl = null;
				}
				return;
			}

			const summary = ensureProgressSummary();
			summary.classList.toggle('expanded', !progressCollapsed);
			summary.textContent = progressCollapsed
				? '进度记录（' + nodes.length + '）已折叠，点击展开'
				: '进度记录（' + nodes.length + '）点击折叠';
		}

		function refreshProgressSummary() {
			setProgressCollapsed(progressCollapsed);
		}

		function renderTodos(todos) {
			todosState = Array.isArray(todos) ? todos : [];
			todoList.innerHTML = '';
			if (todosState.length === 0) {
				todoPanel.classList.remove('show');
				composerShell.classList.remove('has-todos');
				todoSummary.textContent = '';
				setTodoCollapsed(todoCollapsed);
				return;
			}

			const doneCount = todosState.filter((todo) => !!todo.completed).length;
			todoSummary.textContent = doneCount + '/' + todosState.length + ' completed';
			todoPanel.classList.add('show');
			composerShell.classList.add('has-todos');
			setTodoCollapsed(todoCollapsed);

			todosState.forEach((todo, index) => {
				const row = document.createElement('div');
				row.className = 'todo-item' + (todo.completed ? ' done' : '');
				const marker = document.createElement('span');
				marker.className = 'todo-marker';
				marker.textContent = todo.completed ? '✓' : String(index + 1);
				const text = document.createElement('span');
				text.className = 'todo-text';
				text.textContent = todo.text || '';
				row.appendChild(marker);
				row.appendChild(text);
				todoList.appendChild(row);
			});
		}

		function sendMessage() {
			if (isBusy) {
				vscode.postMessage({ type: 'chat:cancelGeneration' });
				return;
			}

			const text = promptInput.value.trim();
			if (!text || sendBtn.disabled) {
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

		function clearTransientToolStatus() {
			if (transientToolStatusHideTimeout) {
				clearTimeout(transientToolStatusHideTimeout);
				transientToolStatusHideTimeout = null;
			}
			toolCallSlot.classList.add('empty');
			toolCallSlot.classList.remove('tool-status-fade-out');
			toolCallSlot.textContent = '';
			transientToolStatusEl = null;
			if (!isBusy) {
				toolCallSlot.classList.add('hidden');
			}
		}

		function fadeTransientToolStatus() {
			if (!transientToolStatusEl) {
				return;
			}
			if (transientToolStatusHideTimeout) {
				clearTimeout(transientToolStatusHideTimeout);
			}
			const active = transientToolStatusEl;
			transientToolStatusHideTimeout = setTimeout(() => {
				if (transientToolStatusEl !== active) {
					return;
				}
				toolCallSlot.classList.add('tool-status-fade-out');
				transientToolStatusHideTimeout = setTimeout(() => {
					if (transientToolStatusEl === active) {
						clearTransientToolStatus();
					}
				}, 220);
			}, 1500);
		}

		function appendTransientToolStatus(text) {
			transientToolStatusEl = toolCallSlot;
			keepTransientToolStatusAtBottom();

			if (transientToolStatusHideTimeout) {
				clearTimeout(transientToolStatusHideTimeout);
				transientToolStatusHideTimeout = null;
			}

			toolCallSlot.classList.remove('empty');
			toolCallSlot.classList.remove('tool-status-fade-out');
			toolCallSlot.classList.remove('tool-status-switch');
			toolCallSlot.textContent = text;
			void toolCallSlot.offsetWidth;
			toolCallSlot.classList.add('tool-status-switch');
			activeAssistantMessage = null;
			chatBody.scrollTop = chatBody.scrollHeight;
		}

		function appendToolStatus(text, transient) {
			if (transient) {
				appendTransientToolStatus(text);
				return;
			}
			const el = document.createElement('div');
			el.className = 'tool-status progress-entry';
			el.textContent = text;
			el.classList.add('progress-entry-appear');
			chatBody.insertBefore(el, toolCallSlot);
			keepTransientToolStatusAtBottom();
			activeAssistantMessage = null;
			refreshProgressSummary();
			chatBody.scrollTop = chatBody.scrollHeight;
		}

		function appendElapsedStatus(text) {
			const el = document.createElement('div');
			el.className = 'tool-status elapsed-status';
			el.textContent = text;
			el.classList.add('progress-entry-appear');
			chatBody.insertBefore(el, toolCallSlot);
			keepTransientToolStatusAtBottom();
			refreshProgressSummary();
			chatBody.scrollTop = chatBody.scrollHeight;
		}

		sendBtn.addEventListener('click', sendMessage);
		todoToggleBtn.addEventListener('click', () => {
			setTodoCollapsed(!todoCollapsed);
		});
		settingsBtn.addEventListener('click', () => {
			if (isBusy) {
				return;
			}
			vscode.postMessage({ type: 'chat:openSettings' });
		});
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
		setTodoCollapsed(false);

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message.type === 'chat:assistantStart') {
				activeAssistantMessage = null;
				clearTransientToolStatus();
				setProgressCollapsed(false);
				setLoading(true);
			}
			if (message.type === 'chat:assistantDelta') {
				appendAssistantDelta(message.text || '');
			}
			if (message.type === 'chat:assistantDone') {
				clearTransientToolStatus();
				setProgressCollapsed(true);
				finishAssistantMessage();
			}
			if (message.type === 'chat:toolStatus') {
				appendToolStatus(message.text || '', !!message.transient);
			}
			if (message.type === 'chat:toolStatusDone') {
				fadeTransientToolStatus();
			}
			if (message.type === 'chat:elapsed') {
				appendElapsedStatus(message.text || '');
			}
			if (message.type === 'chat:error') {
				if (activeAssistantMessage && !(activeAssistantMessage.dataset.rawMarkdown || '').trim()) {
					const fallback = message.text || '请求失败';
					activeAssistantMessage.dataset.rawMarkdown = fallback;
					activeAssistantMessage.innerHTML = renderMarkdown(fallback);
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
			if (message.type === 'chat:todos') {
				if (message.sessionId === currentSessionId) {
					renderTodos(message.todos || []);
				}
			}
			if (message.type === 'chat:externalUserMessage') {
				appendMessage('user', message.text || '');
			}
		});
		vscode.postMessage({ type: 'chat:ready' });
	</script>
</body>
</html>`;
	}


