import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import MarkdownIt = require('markdown-it');

type ChatRole = 'user' | 'assistant';

type ChatSession = {
	id: string;
	title: string;
	createdAt: number;
};

type ChatTodo = {
	id: string;
	text: string;
	completed: boolean;
	createdAt: number;
	completedAt?: number;
};

type RenderableMessage = {
	role: ChatRole;
	text: string;
};

type ChatStatusEntry = {
	kind: 'progress' | 'elapsed';
	text: string;
	runId: number;
	createdAt: number;
};

type ChatSessionViewState = {
	timeline: ChatTimelineEntry[];
	isGenerating: boolean;
	activeAssistantText: string;
	activeRunId: number;
};

type ChatTimelineEntry =
	| {
		kind: 'message';
		role: ChatRole;
		text: string;
		createdAt: number;
	}
	| {
		kind: 'status';
		statusKind: ChatStatusEntry['kind'];
		text: string;
		runId: number;
		createdAt: number;
	};

type SidebarMessage = {
	type?: string;
	text?: string;
	transient?: boolean;
	sessionId?: string;
	currentSessionId?: string;
	state?: ChatSessionViewState | null;
	sessions?: ChatSession[];
	messages?: RenderableMessage[];
	todos?: ChatTodo[];
	message?: string;
	activeRunId?: number;
	title?: string;
	runId?: number;
	kind?: ChatStatusEntry['kind'];
	statusEntries?: ChatStatusEntry[];
	activeAssistantText?: string;
	isGenerating?: boolean;
	activeIndex?: number;
	focusTargets?: unknown[];
	createdAt?: number;
	role?: ChatRole;
	id?: string;
	completed?: boolean;
	updatedAt?: number;
	startLine?: number;
	endLine?: number;
	path?: string;
	instruction?: string;
	focusTargetId?: string;
	focusTargetIds?: string[];
	titleText?: string;
	name?: string;
	label?: string;
	value?: string;
	data?: unknown;
	completedAt?: number;
	createdAtMs?: number;
	timestamp?: number;
	content?: string;
	error?: string;
	status?: string;
	raw?: string;
	markdown?: string;
	messageText?: string;
	payload?: unknown;
	progress?: unknown;
	elapsed?: string;
	todoId?: string;
	todoText?: string;
	todoCompleted?: boolean;
	nextTitle?: string;
	preview?: string;
};

declare function acquireVsCodeApi(): {
	postMessage(message: unknown): void;
	setState?(state: unknown): void;
	getState?(): unknown;
};

const DEFAULT_WELCOME_MESSAGE =
	'你今天想构建什么？直接贴需求、报错或相关代码；我会先读取项目上下文，并在聊天区实时同步当前进度，再给你可立即执行的下一步。';
const DEFAULT_EMPTY_ASSISTANT_MESSAGE = '我暂时没有生成可显示的文本响应。';
const TODO_BOTTOM_STICKY_THRESHOLD_PX = 120;

const markdown = new MarkdownIt({
	html: false,
	breaks: true,
	linkify: true,
	typographer: false,
	highlight(code, language) {
		const normalizedLanguage = (language || '').trim().toLowerCase();
		const result = normalizedLanguage && hljs.getLanguage(normalizedLanguage)
			? hljs.highlight(code, { language: normalizedLanguage, ignoreIllegals: true })
			: hljs.highlightAuto(code);
		const resolvedLanguage = sanitizeLanguageLabel(normalizedLanguage || result.language || 'text');
		return `<pre class="md-pre hljs" data-language="${resolvedLanguage}"><code class="hljs${resolvedLanguage ? ` language-${resolvedLanguage}` : ''}">${result.value}</code></pre>`;
	}
});

const vscode = acquireVsCodeApi();
const chatHeader = requireElement<HTMLDivElement>('.chat-header');
const chatBody = requireElement<HTMLDivElement>('#chatBody');
const promptInput = requireElement<HTMLTextAreaElement>('#prompt');
const settingsBtn = requireElement<HTMLButtonElement>('#settingsBtn');
const sendBtn = requireElement<HTMLButtonElement>('#sendBtn');
const composerShell = requireElement<HTMLDivElement>('#composerShell');
const todoPanel = requireElement<HTMLDivElement>('#todoPanel');
const todoToggleBtn = requireElement<HTMLButtonElement>('#todoToggleBtn');
const todoList = requireElement<HTMLDivElement>('#todoList');
const todoSummary = requireElement<HTMLSpanElement>('#todoSummary');
const sessionDropdown = requireElement<HTMLDivElement>('#sessionDropdown');
const activeSessionLabel = requireElement<HTMLDivElement>('#activeSessionLabel');
const chatChevron = requireElement<HTMLDivElement>('.chat-chevron');
const toolCallSlot = requireElement<HTMLDivElement>('#toolCallSlot');
const loading = requireElement<HTMLDivElement>('#loading');

let activeAssistantMessage: HTMLDivElement | null = null;
let currentSessionId = '';
let isBusy = false;
let sessionsState: ChatSession[] = [];
let todosState: ChatTodo[] = [];
let editingSessionId = '';
let startAckTimeout: ReturnType<typeof setTimeout> | null = null;
let transientToolStatusEl: HTMLDivElement | null = null;
let transientToolStatusHideTimeout: ReturnType<typeof setTimeout> | null = null;
let nextProgressRunId = 1;
let activeProgressRunId = 0;
const progressRunNodes = new Map<number, HTMLDivElement[]>();
const progressRunSummaryEls = new Map<number, HTMLButtonElement>();
const progressRunCollapsed = new Map<number, boolean>();
const progressRunFinalizeTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
let assistantSentDelta = false;
let cancellationInFlight = false;
let todoCollapsed = false;

function requireElement<T extends Element>(selector: string): T {
	const element = document.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Missing required element: ${selector}`);
	}
	return element;
}

function renderMarkdown(raw: string): string {
	const source = (raw || '').replace(/\r\n/g, '\n').trim();
	if (!source) {
		return '';
	}

	const rendered = markdown.render(source);
	const sanitized = DOMPurify.sanitize(rendered, {
		USE_PROFILES: { html: true },
		FORBID_TAGS: ['style', 'script'],
		FORBID_ATTR: ['style', 'onerror', 'onload']
	});
	const template = document.createElement('template');
	template.innerHTML = sanitized;
	template.content.querySelectorAll('a[href]').forEach((anchor) => {
		const href = anchor.getAttribute('href') || '';
		if (!isSafeHref(href)) {
			anchor.replaceWith(document.createTextNode(anchor.textContent || href));
			return;
		}
		anchor.setAttribute('target', '_blank');
		anchor.setAttribute('rel', 'noopener noreferrer');
	});
	template.content.querySelectorAll('pre.md-pre').forEach((preElement) => {
		enhanceCodeBlock(preElement as HTMLPreElement);
	});
	return template.innerHTML;
}

function sanitizeLanguageLabel(language: string): string {
	const normalized = (language || '').trim().toLowerCase();
	return normalized.replace(/[^a-z0-9#+.-]/g, '') || 'text';
}

function formatLanguageLabel(language: string): string {
	const normalized = sanitizeLanguageLabel(language);
	if (normalized === 'plaintext') {
		return 'text';
	}
	if (normalized === 'javascript') {
		return 'JavaScript';
	}
	if (normalized === 'typescript') {
		return 'TypeScript';
	}
	if (normalized === 'json') {
		return 'JSON';
	}
	if (normalized === 'xml') {
		return 'XML';
	}
	if (normalized === 'html') {
		return 'HTML';
	}
	if (normalized === 'css') {
		return 'CSS';
	}
	if (normalized === 'sql') {
		return 'SQL';
	}
	if (normalized === 'bash' || normalized === 'shell' || normalized === 'sh') {
		return 'Shell';
	}
	if (normalized.length <= 3) {
		return normalized.toUpperCase();
	}
	return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function enhanceCodeBlock(preElement: HTMLPreElement): void {
	if (preElement.parentElement?.classList.contains('md-code-block')) {
		return;
	}
	const codeElement = preElement.querySelector('code');
	if (!codeElement) {
		return;
	}
	const language = sanitizeLanguageLabel(preElement.dataset.language || 'text');
	const wrapper = document.createElement('div');
	wrapper.className = 'md-code-block';
	wrapper.dataset.language = language;

	const toolbar = document.createElement('div');
	toolbar.className = 'md-code-toolbar';

	const label = document.createElement('span');
	label.className = 'md-code-language';
	label.textContent = formatLanguageLabel(language);

	const copyButton = document.createElement('button');
	copyButton.type = 'button';
	copyButton.className = 'md-code-copy';
	copyButton.textContent = 'Copy';
	copyButton.setAttribute('aria-label', `复制 ${formatLanguageLabel(language)} 代码块`);

	toolbar.appendChild(label);
	toolbar.appendChild(copyButton);
	preElement.replaceWith(wrapper);
	wrapper.appendChild(toolbar);
	wrapper.appendChild(preElement);
}

async function copyCodeBlock(trigger: HTMLButtonElement): Promise<void> {
	const block = trigger.closest('.md-code-block');
	if (!(block instanceof HTMLElement)) {
		return;
	}
	const codeElement = block.querySelector('code');
	const text = codeElement?.textContent || '';
	if (!text) {
		return;
	}
	await copyText(text);
	const previousLabel = trigger.textContent || 'Copy';
	trigger.textContent = 'Copied';
	trigger.disabled = true;
	setTimeout(() => {
		trigger.textContent = previousLabel;
		trigger.disabled = false;
	}, 1200);
}

async function copyText(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}
	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.setAttribute('readonly', 'true');
	textarea.style.position = 'absolute';
	textarea.style.opacity = '0';
	textarea.style.pointerEvents = 'none';
	document.body.appendChild(textarea);
	textarea.select();
	document.execCommand('copy');
	textarea.remove();
}

function isSafeHref(href: string): boolean {
	const raw = href.trim();
	if (!raw) {
		return false;
	}
	if (raw.startsWith('#')) {
		return true;
	}
	try {
		const parsed = new URL(raw, 'https://example.invalid');
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
	} catch {
		return false;
	}
}

function setLoading(isLoading: boolean): void {
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
		return;
	}
	loading.classList.remove('show');
	toolCallSlot.classList.add('hidden');
	sendBtn.disabled = false;
	sendBtn.textContent = 'Send';
	sendBtn.classList.remove('composer-cancel');
	settingsBtn.disabled = false;
}

function scrollChatToBottom(smooth: boolean): void {
	const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
	if (typeof chatBody.scrollTo === 'function') {
		chatBody.scrollTo({ top: chatBody.scrollHeight, behavior });
		return;
	}
	chatBody.scrollTop = chatBody.scrollHeight;
}

function appendMessage(role: ChatRole, text: string, smoothScrollToBottom = false): HTMLDivElement {
	const el = document.createElement('div');
	el.className = `message ${role}`;
	el.dataset.rawMarkdown = text || '';
	el.innerHTML = renderMarkdown(text || '');
	chatBody.insertBefore(el, toolCallSlot);
	scrollChatToBottom(!!smoothScrollToBottom);
	return el;
}

function autoResizePrompt(): void {
	promptInput.style.height = 'auto';
	const maxHeight = 120;
	const nextHeight = Math.min(promptInput.scrollHeight, maxHeight);
	promptInput.style.height = `${nextHeight}px`;
	promptInput.style.overflowY = promptInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function setTodoCollapsed(collapsed: boolean): void {
	const distanceToBottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight;
	const shouldStickToBottom = distanceToBottom <= TODO_BOTTOM_STICKY_THRESHOLD_PX;
	todoCollapsed = !!collapsed;
	todoPanel.classList.toggle('collapsed', todoCollapsed);
	todoToggleBtn.textContent = `${todoCollapsed ? '▸' : '▾'} TODO`;
	todoToggleBtn.setAttribute('aria-expanded', String(!todoCollapsed));
	if (!shouldStickToBottom) {
		return;
	}
	requestAnimationFrame(() => {
		chatBody.scrollTop = chatBody.scrollHeight;
	});
}

function startAssistantMessage(): void {
	if (!activeAssistantMessage) {
		activeAssistantMessage = appendMessage('assistant', '');
	}
}

function appendAssistantDelta(text: string): void {
	startAssistantMessage();
	const nextRaw = (activeAssistantMessage?.dataset.rawMarkdown || '') + text;
	if (!activeAssistantMessage) {
		return;
	}
	activeAssistantMessage.dataset.rawMarkdown = nextRaw;
	activeAssistantMessage.innerHTML = renderMarkdown(nextRaw);
	chatBody.scrollTop = chatBody.scrollHeight;
}

function finishAssistantMessage(): void {
	if (!activeAssistantMessage) {
		appendMessage('assistant', DEFAULT_EMPTY_ASSISTANT_MESSAGE);
		setLoading(false);
		return;
	}
	const raw = activeAssistantMessage.dataset.rawMarkdown || '';
	if (!raw.trim()) {
		activeAssistantMessage.dataset.rawMarkdown = DEFAULT_EMPTY_ASSISTANT_MESSAGE;
		activeAssistantMessage.innerHTML = renderMarkdown(DEFAULT_EMPTY_ASSISTANT_MESSAGE);
	}
	activeAssistantMessage = null;
	setLoading(false);
}

function resetChat(): void {
	chatBody.querySelectorAll('.message').forEach((node) => node.remove());
	chatBody.querySelectorAll('.tool-status').forEach((node) => node.remove());
	keepTransientToolStatusAtBottom();
	toolCallSlot.classList.add('empty');
	toolCallSlot.textContent = '';
	progressRunFinalizeTimeouts.forEach((timeoutId) => {
		clearTimeout(timeoutId);
	});
	progressRunFinalizeTimeouts.clear();
	progressRunSummaryEls.forEach((summaryEl) => {
		summaryEl.remove();
	});
	progressRunSummaryEls.clear();
	progressRunNodes.clear();
	progressRunCollapsed.clear();
	activeProgressRunId = 0;
	assistantSentDelta = false;
	cancellationInFlight = false;
	transientToolStatusEl = null;
	appendMessage('assistant', DEFAULT_WELCOME_MESSAGE);
	activeAssistantMessage = null;
	setLoading(false);
}

function getProgressRunNodes(runId: number): HTMLDivElement[] {
	const nodes = progressRunNodes.get(runId) || [];
	const activeNodes = nodes.filter((node) => !!node && node.isConnected);
	if (activeNodes.length !== nodes.length) {
		progressRunNodes.set(runId, activeNodes);
	}
	return activeNodes;
}

function keepTransientToolStatusAtBottom(): void {
	chatBody.insertBefore(toolCallSlot, loading);
}

function ensureProgressRunSummary(runId: number): HTMLButtonElement {
	const currentSummary = progressRunSummaryEls.get(runId);
	if (currentSummary && currentSummary.isConnected) {
		return currentSummary;
	}
	const summary = document.createElement('button');
	summary.type = 'button';
	summary.className = 'progress-summary';
	summary.addEventListener('click', () => {
		const collapsed = !!progressRunCollapsed.get(runId);
		setProgressRunCollapsed(runId, !collapsed);
	});
	progressRunSummaryEls.set(runId, summary);
	const firstProgressNode = getProgressRunNodes(runId)[0] ?? loading;
	chatBody.insertBefore(summary, firstProgressNode);
	return summary;
}

function setProgressRunCollapsed(runId: number, collapsed: boolean): void {
	const nextCollapsed = !!collapsed;
	progressRunCollapsed.set(runId, nextCollapsed);
	const previousTimeout = progressRunFinalizeTimeouts.get(runId);
	if (previousTimeout) {
		clearTimeout(previousTimeout);
		progressRunFinalizeTimeouts.delete(runId);
	}
	const nodes = getProgressRunNodes(runId);

	if (!nextCollapsed) {
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
		const timeoutId = setTimeout(() => {
			if (!progressRunCollapsed.get(runId)) {
				return;
			}
			const activeNodes = getProgressRunNodes(runId);
			activeNodes.forEach((node) => {
				node.classList.add('progress-collapsed-done');
				node.style.display = 'none';
			});
		}, 240);
		progressRunFinalizeTimeouts.set(runId, timeoutId);
	}

	if (nodes.length === 0) {
		const summaryEl = progressRunSummaryEls.get(runId);
		if (summaryEl) {
			summaryEl.remove();
		}
		progressRunSummaryEls.delete(runId);
		progressRunCollapsed.delete(runId);
		progressRunFinalizeTimeouts.delete(runId);
		progressRunNodes.delete(runId);
		return;
	}

	const summary = ensureProgressRunSummary(runId);
	summary.classList.toggle('expanded', !nextCollapsed);
	summary.textContent = nextCollapsed
		? `进度记录（${nodes.length}）已折叠，点击展开`
		: `进度记录（${nodes.length}）点击折叠`;
}

function renderTodos(todos: ChatTodo[]): void {
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
	todoSummary.textContent = `${doneCount}/${todosState.length} completed`;
	todoPanel.classList.add('show');
	composerShell.classList.add('has-todos');
	setTodoCollapsed(todoCollapsed);

	todosState.forEach((todo, index) => {
		const row = document.createElement('div');
		row.className = `todo-item${todo.completed ? ' done' : ''}`;
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

function sendMessage(): void {
	if (isBusy) {
		cancellationInFlight = true;
		vscode.postMessage({ type: 'chat:cancelGeneration' });
		return;
	}

	const text = promptInput.value.trim();
	if (!text || sendBtn.disabled) {
		return;
	}

	appendMessage('user', text, true);
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

function openSessionDropdown(): void {
	sessionDropdown.classList.add('show');
	chatChevron.classList.add('open');
}

function closeSessionDropdown(): void {
	sessionDropdown.classList.remove('show');
	chatChevron.classList.remove('open');
	editingSessionId = '';
}

function toggleSessionDropdown(): void {
	if (sessionDropdown.classList.contains('show')) {
		closeSessionDropdown();
		return;
	}
	openSessionDropdown();
}

function renderSessions(sessions: ChatSession[], activeSessionId: string): void {
	sessionsState = Array.isArray(sessions) ? sessions : [];
	sessionDropdown.innerHTML = '';
	currentSessionId = activeSessionId || '';

	sessionsState.forEach((session) => {
		const row = document.createElement('div');
		row.className = `session-card${session.id === currentSessionId ? ' active' : ''}`;

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

function renderSessionHistory(messages: RenderableMessage[]): void {
	resetChat();
	if (!Array.isArray(messages) || messages.length === 0) {
		return;
	}

	chatBody.querySelectorAll('.message').forEach((node) => node.remove());
	messages.forEach((message) => {
		appendMessage(message.role === 'user' ? 'user' : 'assistant', message.text || '');
	});
}

function clearTransientToolStatus(): void {
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

function fadeTransientToolStatus(): void {
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

function appendTransientToolStatus(text: string): void {
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

function appendToolStatus(text: string, transient: boolean): void {
	if (transient) {
		appendTransientToolStatus(text);
		return;
	}
	if (!activeProgressRunId) {
		activeProgressRunId = nextProgressRunId;
		nextProgressRunId += 1;
	}
	const el = document.createElement('div');
	el.className = 'tool-status progress-entry';
	el.textContent = text;
	el.classList.add('progress-entry-appear');
	el.dataset.progressRunId = String(activeProgressRunId);
	const runNodes = progressRunNodes.get(activeProgressRunId) || [];
	runNodes.push(el);
	progressRunNodes.set(activeProgressRunId, runNodes);
	chatBody.insertBefore(el, toolCallSlot);
	keepTransientToolStatusAtBottom();
	activeAssistantMessage = null;
	setProgressRunCollapsed(activeProgressRunId, false);
	chatBody.scrollTop = chatBody.scrollHeight;
}

function appendElapsedStatus(text: string): void {
	const el = document.createElement('div');
	el.className = 'tool-status elapsed-status';
	el.textContent = text;
	el.classList.add('progress-entry-appear');
	chatBody.insertBefore(el, toolCallSlot);
	keepTransientToolStatusAtBottom();
	chatBody.scrollTop = chatBody.scrollHeight;
}

function appendHistoricalStatus(text: string, kind: ChatStatusEntry['kind'], runId: number): void {
	if (kind === 'elapsed') {
		const el = document.createElement('div');
		el.className = 'tool-status elapsed-status';
		el.textContent = text;
		chatBody.insertBefore(el, toolCallSlot);
		keepTransientToolStatusAtBottom();
		return;
	}

	const normalizedRunId = Number.isFinite(runId) && runId > 0 ? runId : nextProgressRunId++;
	nextProgressRunId = Math.max(nextProgressRunId, normalizedRunId + 1);
	const el = document.createElement('div');
	el.className = 'tool-status progress-entry';
	el.textContent = text;
	el.dataset.progressRunId = String(normalizedRunId);
	const runNodes = progressRunNodes.get(normalizedRunId) || [];
	runNodes.push(el);
	progressRunNodes.set(normalizedRunId, runNodes);
	chatBody.insertBefore(el, toolCallSlot);
	keepTransientToolStatusAtBottom();
}

function renderSessionState(state: ChatSessionViewState | null): void {
	resetChat();
	if (!state || typeof state !== 'object') {
		return;
	}

	const timeline = Array.isArray(state.timeline) ? state.timeline : [];
	timeline.forEach((entry) => {
		if (entry.kind === 'message') {
			appendMessage(entry.role === 'user' ? 'user' : 'assistant', entry.text || '');
			return;
		}
		appendHistoricalStatus(entry.text || '', entry.statusKind || 'progress', Number(entry.runId));
	});

	const isGenerating = !!state.isGenerating;
	const activeAssistantText = typeof state.activeAssistantText === 'string' ? state.activeAssistantText : '';
	const activeRunId = Number(state.activeRunId);
	Array.from(progressRunNodes.keys())
		.sort((left, right) => left - right)
		.forEach((runId) => {
			const shouldCollapse = !isGenerating || runId !== activeRunId || !!activeAssistantText;
			setProgressRunCollapsed(runId, shouldCollapse);
		});
	if (isGenerating) {
		if (Number.isFinite(activeRunId) && activeRunId > 0) {
			activeProgressRunId = activeRunId;
			nextProgressRunId = Math.max(nextProgressRunId, activeRunId + 1);
		} else {
			activeProgressRunId = nextProgressRunId;
			nextProgressRunId += 1;
		}
		if (activeAssistantText) {
			activeAssistantMessage = appendMessage('assistant', activeAssistantText);
		}
		setLoading(true);
		return;
	}

	activeProgressRunId = 0;
	activeAssistantMessage = null;
	setLoading(false);
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
chatBody.addEventListener('click', (event) => {
	const target = event.target;
	if (!(target instanceof HTMLElement)) {
		return;
	}
	const button = target.closest('.md-code-copy');
	if (!(button instanceof HTMLButtonElement)) {
		return;
	}
	void copyCodeBlock(button);
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

window.addEventListener('message', (event: MessageEvent<SidebarMessage>) => {
	const message = event.data || {};
	if (message.type === 'chat:assistantStart') {
		activeAssistantMessage = null;
		clearTransientToolStatus();
		activeProgressRunId = nextProgressRunId;
		nextProgressRunId += 1;
		assistantSentDelta = false;
		cancellationInFlight = false;
		setLoading(true);
	}
	if (message.type === 'chat:assistantDelta') {
		if (activeProgressRunId && !cancellationInFlight) {
			setProgressRunCollapsed(activeProgressRunId, true);
		}
		assistantSentDelta = true;
		if (!cancellationInFlight) {
			activeProgressRunId = 0;
		}
		appendAssistantDelta(message.text || '');
	}
	if (message.type === 'chat:assistantDone') {
		if (cancellationInFlight) {
			fadeTransientToolStatus();
		} else {
			clearTransientToolStatus();
		}
		if (!assistantSentDelta && activeProgressRunId && !cancellationInFlight) {
			setProgressRunCollapsed(activeProgressRunId, true);
		}
		activeProgressRunId = 0;
		assistantSentDelta = false;
		cancellationInFlight = false;
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
	if (message.type === 'chat:sessionState') {
		if (message.sessionId === currentSessionId) {
			renderSessionState(message.state || null);
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