// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, type MessageContent } from '@langchain/core/messages';
import { DynamicTool } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const SYSTEM_PROMPT = 'You are Navi, a practical coding assistant. Keep answers concise, actionable, and developer-friendly.';
const USER_TIMEZONE = 'Asia/Shanghai';

type ChatInboundMessage = {
	type?: string;
	text?: string;
	sessionId?: string;
	title?: string;
};

type ChatSession = {
	id: string;
	title: string;
	createdAt: number;
};

type RenderableMessage = {
	role: 'user' | 'assistant';
	text: string;
};

class NaviSidebarViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'navi.sidebarWebview';
	private chatModel?: ChatOpenAI;
	private agent?: ReturnType<typeof createReactAgent>;
	private isGenerating = false;
	private readonly checkpointer = new MemorySaver();
	private readonly sessions: ChatSession[] = [];
	private currentSessionId = '';

	constructor(private readonly extensionUri: vscode.Uri) {
		const firstSession = this.createSession();
		this.currentSessionId = firstSession.id;
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		webviewView.webview.html = this.getHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage(async (message: ChatInboundMessage) => {
			if (message.type === 'chat:ready') {
				await this.syncSessionsToWebview(webviewView.webview);
				return;
			}

			if (message.type === 'chat:newSession') {
				if (this.isGenerating) {
					await this.postError(webviewView.webview, '当前回答尚未完成，请稍后再新建会话。');
					return;
				}

				const session = this.createSession();
				this.currentSessionId = session.id;
				await this.syncSessionsToWebview(webviewView.webview);
				return;
			}

			if (message.type === 'chat:switchSession') {
				if (this.isGenerating) {
					await this.postError(webviewView.webview, '当前回答尚未完成，请稍后再切换会话。');
					return;
				}

				const sessionId = message.sessionId ?? '';
				if (!sessionId || !this.sessions.some((session) => session.id === sessionId)) {
					await this.postError(webviewView.webview, '目标会话不存在。');
					return;
				}

				this.currentSessionId = sessionId;
				await this.syncSessionsToWebview(webviewView.webview);
				return;
			}

			if (message.type === 'chat:renameSession') {
				const sessionId = message.sessionId ?? '';
				const nextTitle = (message.title ?? '').trim();
				if (!sessionId || !nextTitle) {
					await this.postError(webviewView.webview, '重命名失败：标题不能为空。');
					return;
				}

				const renamed = this.renameSession(sessionId, nextTitle);
				if (!renamed) {
					await this.postError(webviewView.webview, '重命名失败：会话不存在。');
					return;
				}

				await this.syncSessionsToWebview(webviewView.webview);
				return;
			}

			if (message.type === 'chat:deleteSession') {
				if (this.isGenerating) {
					await this.postError(webviewView.webview, '当前回答尚未完成，请稍后再删除会话。');
					return;
				}

				const sessionId = message.sessionId ?? '';
				if (!sessionId) {
					await this.postError(webviewView.webview, '删除失败：会话不存在。');
					return;
				}

				const confirm = await vscode.window.showWarningMessage(
					'确定要删除这个会话吗？',
					{ modal: true },
					'删除'
				);
				if (confirm !== '删除') {
					return;
				}

				const deleted = this.deleteSession(sessionId);
				if (!deleted) {
					await this.postError(webviewView.webview, '删除失败：会话不存在。');
					return;
				}

				await this.syncSessionsToWebview(webviewView.webview);
				return;
			}

			if (message.type !== 'chat:userMessage') {
				return;
			}

			const prompt = (message.text ?? '').trim();
			if (!prompt) {
				return;
			}

			await this.handleUserMessage(webviewView.webview, prompt);
		});
	}

	private async handleUserMessage(webview: vscode.Webview, prompt: string): Promise<void> {
		if (this.isGenerating) {
			await this.postError(webview, '请等待当前回答完成后再发送下一条消息。');
			return;
		}

		this.isGenerating = true;
		const startedAt = Date.now();
		await webview.postMessage({ type: 'chat:assistantStart' });

		try {
			const agent = this.getOrCreateAgent();
			this.updateSessionTitleIfNeeded(this.currentSessionId, prompt);
			await this.postSessionSummary(webview);

			const stream = await agent.streamEvents(
				{
					messages: [new HumanMessage(prompt)]
				},
				{
					version: 'v2',
					configurable: {
						thread_id: this.currentSessionId
					}
				}
			);

			let assistantText = '';
			for await (const chunk of stream) {
				if (chunk.event === 'on_tool_start') {
					const toolName = chunk.name ?? 'unknown_tool';
					await webview.postMessage({
						type: 'chat:toolStatus',
						text: `正在调用工具 \`${toolName}\`...`
					});
					continue;
				}

				if (chunk.event === 'on_tool_end') {
					continue;
				}

				if (chunk.event !== 'on_chat_model_stream') {
					continue;
				}

				const modelChunk = chunk.data?.chunk;
				const delta = extractMessageText(modelChunk?.content);
				if (!delta) {
					continue;
				}
				assistantText += delta;
				await webview.postMessage({
					type: 'chat:assistantDelta',
					text: delta
				});
			}

			const normalizedAnswer = assistantText.trim() || '我暂时没有生成可显示的文本响应。';
			if (!assistantText.trim()) {
				await webview.postMessage({
					type: 'chat:assistantDelta',
					text: normalizedAnswer
				});
			}

			const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(2);
			await webview.postMessage({
				type: 'chat:elapsed',
				text: `用时：${elapsedSeconds}s`
			});
		} catch (error) {
			const messageText = error instanceof Error ? error.message : 'Unknown error';
			await this.postError(webview, `请求 DeepSeek 失败：${messageText}`);
		} finally {
			this.isGenerating = false;
			await webview.postMessage({ type: 'chat:assistantDone' });
		}
	}

	private async postError(webview: vscode.Webview, text: string): Promise<void> {
		await webview.postMessage({
			type: 'chat:error',
			text
		});
	}

	private createSession(): ChatSession {
		const session: ChatSession = {
			id: createThreadId(),
			title: 'New Chat',
			createdAt: Date.now()
		};

		this.sessions.unshift(session);
		return session;
	}

	private updateSessionTitleIfNeeded(sessionId: string, prompt: string): void {
		const session = this.sessions.find((item) => item.id === sessionId);
		if (!session || session.title !== 'New Chat') {
			return;
		}

		const normalized = prompt.replace(/\s+/g, ' ').trim();
		session.title = normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
	}

	private renameSession(sessionId: string, nextTitle: string): boolean {
		const session = this.sessions.find((item) => item.id === sessionId);
		if (!session) {
			return false;
		}

		const normalized = nextTitle.replace(/\s+/g, ' ').trim();
		session.title = normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
		return true;
	}

	private deleteSession(sessionId: string): boolean {
		const index = this.sessions.findIndex((item) => item.id === sessionId);
		if (index < 0) {
			return false;
		}

		const deletingCurrent = this.currentSessionId === sessionId;
		this.sessions.splice(index, 1);

		if (this.sessions.length === 0) {
			const session = this.createSession();
			this.currentSessionId = session.id;
			return true;
		}

		if (deletingCurrent) {
			const nextIndex = Math.min(index, this.sessions.length - 1);
			this.currentSessionId = this.sessions[nextIndex].id;
		}

		return true;
	}

	private async postSessionSummary(webview: vscode.Webview): Promise<void> {
		await webview.postMessage({
			type: 'chat:sessions',
			sessions: this.sessions,
			currentSessionId: this.currentSessionId
		});
	}

	private async syncSessionsToWebview(webview: vscode.Webview): Promise<void> {
		await this.postSessionSummary(webview);
		const messages = await this.loadSessionMessages(this.currentSessionId);
		await webview.postMessage({
			type: 'chat:sessionHistory',
			sessionId: this.currentSessionId,
			messages
		});
	}

	private async loadSessionMessages(sessionId: string): Promise<RenderableMessage[]> {
		if (!this.agent) {
			return [];
		}

		const state = await this.agent.getState({
			configurable: {
				thread_id: sessionId
			}
		});

		const values = state.values as { messages?: unknown } | undefined;
		const messages = values?.messages;
		if (!Array.isArray(messages)) {
			return [];
		}

		return messages
			.map((message) => {
				const type = getMessageType(message);
				if (type !== 'human' && type !== 'ai') {
					return undefined;
				}

				const text = extractMessageText((message as { content?: MessageContent }).content).trim();
				if (!text) {
					return undefined;
				}

				return {
					role: type === 'human' ? 'user' : 'assistant',
					text
				} as RenderableMessage;
			})
			.filter((item): item is RenderableMessage => item !== undefined);
	}

	private getOrCreateAgent(): ReturnType<typeof createReactAgent> {
		if (this.agent) {
			return this.agent;
		}

		const config = vscode.workspace.getConfiguration('navi');
		const apiKey = (process.env.DEEPSEEK_API_KEY ?? config.get<string>('deepseekApiKey') ?? '').trim();
		if (!apiKey) {
			throw new Error('缺少 API Key。请设置环境变量 DEEPSEEK_API_KEY 或在 Settings 中配置 navi.deepseekApiKey。');
		}

		const model = config.get<string>('deepseekModel', DEFAULT_DEEPSEEK_MODEL);
		const baseURL = config.get<string>('deepseekBaseUrl', DEFAULT_DEEPSEEK_BASE_URL);
		const temperature = config.get<number>('temperature', 0.2);

		this.chatModel = new ChatOpenAI({
			apiKey,
			model,
			temperature,
			configuration: { baseURL }
		});

		this.agent = createReactAgent({
			llm: this.chatModel,
			tools: [this.getDateTimeTool()],
			prompt: SYSTEM_PROMPT,
			checkpointer: this.checkpointer
		});

		return this.agent;
	}

	private getDateTimeTool(): DynamicTool {
		return new DynamicTool({
			name: 'get_date_time',
			description: `Get current date and time in ${USER_TIMEZONE}.`,
			func: async () => {
				const now = new Date();
				const formatted = new Intl.DateTimeFormat('zh-CN', {
					timeZone: USER_TIMEZONE,
					year: 'numeric',
					month: '2-digit',
					day: '2-digit',
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit',
					hour12: false
				}).format(now);

				return JSON.stringify(
					{
						timezone: USER_TIMEZONE,
						iso: now.toISOString(),
						local: formatted
					},
					null,
					2
				);
			}
		});
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<title>Navi Chat</title>
	<style>
		body {
			margin: 0;
			padding: 0 !important;
			height: 100vh;
			display: flex;
			flex-direction: column;
			font-family: var(--vscode-font-family);
			background: var(--vscode-sideBar-background);
			color: var(--vscode-foreground);
		}
		.chat-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 10px 20px;
			border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
			background: var(--vscode-sideBarSectionHeader-background);
			cursor: pointer;
			user-select: none;
		}
		.chat-header-main {
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.chat-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: #2ea043;
			flex-shrink: 0;
		}
		.chat-title {
			font-size: 12px;
			font-weight: 600;
		}
		.chat-subtitle {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
		}
		.chat-header-right {
			display: flex;
			align-items: center;
			gap: 8px;
			min-width: 0;
			max-width: 55%;
		}
		.chat-session-title {
			max-width: 150px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
		}
		.chat-chevron {
			font-size: 10px;
			opacity: 0.8;
			transition: transform 0.18s ease;
			transform: rotate(0deg);
			display: inline-block;
		}
		.chat-chevron.open {
			transform: rotate(90deg);
		}
		.session-dropdown {
			position: absolute;
			top: 44px;
			left: 8px;
			right: 8px;
			background: var(--vscode-editorWidget-background);
			border: 1px solid var(--vscode-editorWidget-border);
			border-radius: 8px;
			box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
			padding: 6px;
			display: flex;
			flex-direction: column;
			gap: 4px;
			z-index: 20;
			opacity: 0;
			transform: translateY(-6px) scale(0.98);
			pointer-events: none;
			transition: opacity 0.16s ease, transform 0.18s ease;
		}
		.session-dropdown.show {
			opacity: 1;
			transform: translateY(0) scale(1);
			pointer-events: auto;
		}
		.session-card {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 4px;
			border-radius: 8px;
			border: 1px solid transparent;
			background: transparent;
			min-width: 0;
		}
		.session-card:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.session-card.active {
			background: var(--vscode-list-activeSelectionBackground);
			border-color: var(--vscode-focusBorder);
		}
		.session-card-main {
			border: none;
			background: transparent;
			color: var(--vscode-foreground);
			text-align: left;
			padding: 7px 8px;
			border-radius: 6px;
			font-size: 12px;
			cursor: pointer;
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.session-card.active .session-card-main {
			color: var(--vscode-list-activeSelectionForeground);
		}
		.session-item-tools {
			display: flex;
			gap: 4px;
		}
		.session-tool {
			border: 1px solid var(--vscode-toolbar-hoverBackground);
			background: transparent;
			color: var(--vscode-foreground);
			border-radius: 5px;
			padding: 2px 6px;
			font-size: 10px;
			cursor: pointer;
		}
		.session-tool:hover {
			background: var(--vscode-toolbar-hoverBackground);
		}
		.session-inline-input {
			width: 100%;
			border: 1px solid var(--vscode-input-border);
			border-radius: 6px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			padding: 6px 8px;
			font-size: 12px;
			outline: none;
		}
		.session-inline-input:focus {
			border-color: var(--vscode-focusBorder);
		}
		.session-tool.primary {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border-color: transparent;
		}
		.session-tool.primary:hover {
			background: var(--vscode-button-hoverBackground);
		}
		.session-divider {
			height: 1px;
			background: var(--vscode-editorWidget-border);
			margin: 3px 0 2px 0;
		}
		.session-new-chat {
			width: 100%;
			border: none;
			background: transparent;
			color: var(--vscode-foreground);
			text-align: left;
			padding: 7px 8px;
			border-radius: 6px;
			font-size: 12px;
			cursor: pointer;
		}
		.session-new-chat:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.chat-body {
			flex: 1;
			overflow-y: auto;
			padding: 12px 20px;
			display: flex;
			flex-direction: column;
			gap: 10px;
		}
		.message {
			max-width: 100%;
			padding: 0;
			border-radius: 0;
			font-size: 12px;
			line-height: 1.45;
			white-space: pre-wrap;
			word-break: break-word;
		}
		.message.assistant {
			align-self: flex-start;
			max-width: 100%;
			background: transparent;
			border: none;
			color: var(--vscode-foreground);
		}
		.message.user {
			align-self: flex-end;
			padding: 10px 12px;
			border-radius: 10px;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		.loading {
			align-self: flex-start;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			display: none;
		}
		.loading.show {
			display: block;
		}
		.tool-status {
			align-self: flex-start;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			padding: 2px 0;
		}
		.elapsed-status {
			align-self: flex-start;
			text-align: left;
		}
		.chat-footer {
			padding: 10px;
			background: var(--vscode-sideBar-background);
		}
		.composer {
			display: flex;
			flex-direction: column;
			gap: 8px;
			border: 1px solid var(--vscode-input-border);
			border-radius: 8px;
			background: var(--vscode-input-background);
			padding: 8px;
			box-sizing: border-box;
		}
		.composer:focus-within {
			border-color: var(--vscode-focusBorder);
		}
		.composer textarea {
			display: block;
			resize: none;
			min-height: 52px;
			max-height: 120px;
			width: 100%;
			box-sizing: border-box;
			padding: 0;
			border: none;
			background: transparent;
			color: var(--vscode-input-foreground);
			font-family: inherit;
			font-size: 12px;
			line-height: 1.4;
			outline: none;
		}
		.composer-actions {
			display: flex;
			justify-content: flex-end;
			border-top: 1px solid var(--vscode-input-border);
			margin-left: -8px;
			margin-right: -8px;
			padding: 3px 8px 0 8px;
		}
		.composer-send {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border: none;
			border-radius: 8px;
			padding: 0 10px;
			height: 20px;
			min-width: 52px;
			line-height: 1;
			font-size: 12px;
			cursor: pointer;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			width: auto;
			max-width: none;
			margin-top: 4px;
			margin-bottom: 0;
		}
		.composer-send:hover {
			background: var(--vscode-button-hoverBackground);
		}
		.composer-send:disabled {
			opacity: 0.6;
			cursor: default;
		}
	</style>
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
}

function extractMessageText(content?: MessageContent): string {
	if (typeof content === 'string') {
		return content;
	}

	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === 'string') {
					return part;
				}
				if (part.type === 'text') {
					return part.text;
				}
				return '';
			})
			.filter(Boolean)
			.join('');
	}

	return '';
}

function createThreadId(): string {
	return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getMessageType(message: unknown): string | undefined {
	if (!message || typeof message !== 'object') {
		return undefined;
	}

	const typed = message as {
		_getType?: () => string;
		type?: string;
	};

	if (typeof typed._getType === 'function') {
		return typed._getType();
	}

	return typed.type;
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 32; i += 1) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "navi" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const viewProvider = vscode.window.registerWebviewViewProvider(
		NaviSidebarViewProvider.viewType,
		new NaviSidebarViewProvider(context.extensionUri)
	);

	const disposable = vscode.commands.registerCommand('navi.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from Navi!');
	});

	context.subscriptions.push(viewProvider);
	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
