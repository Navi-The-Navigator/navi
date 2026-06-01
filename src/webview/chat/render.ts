import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import MarkdownIt from 'markdown-it';
import {
	DEFAULT_WELCOME_MESSAGE,
	DEFAULT_EMPTY_ASSISTANT_MESSAGE,
	CHAT_BOTTOM_STICKY_THRESHOLD_PX,
	TODO_BOTTOM_STICKY_THRESHOLD_PX,
	COLLAPSE_TRANSITION_MS,
	T,
	vscode,
	requireElement,
	chatTitleBtn,
	headerNewChatBtn,
	chatTitle,
	chatBody,
	promptInput,
	settingsBtn,
	sendBtn,
	composerShell,
	todoPanel,
	todoToggleBtn,
	todoList,
	todoSummary,
	sessionDrawer,
	sessionDrawerOverlay,
	drawerNewChatBtn,
	drawerSearch,
	sessionList,
	activeSessionLabel,
	toolCallSlot,
	loading,
	state,
	progressRunNodes,
	progressRunSummaryEls,
	progressRunCollapsed,
	progressRunFinalizeTimeouts,
	runPanelEls,
	runPanelProgressCollapsed,
	runPanelProgressTouched,
	runPanelProgressFinalizeTimeouts,
	runPanelToolStatusHideTimeouts,
	runPanelToolStatusClearModes,
	runPanelAutoScrollSuppressed,
	renderedRunStates,
	ChatRole,
	ChatSession,
	ChatTodo,
	RenderableMessage,
	ChatRunKind,
	ChatRunStatus,
	ChatRunEventKind,
	ChatRunEvent,
	ChatRun,
	ChatStatusEntry,
	ChatSessionViewState,
	ChatTimelineEntry,
	WebviewMessage
} from './state.js';

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

export function renderMarkdown(raw: string): string {
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

export function sanitizeLanguageLabel(language: string): string {
	const normalized = (language || '').trim().toLowerCase();
	return normalized.replace(/[^a-z0-9#+.-]/g, '') || 'text';
}

export function formatLanguageLabel(language: string): string {
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

export function enhanceCodeBlock(preElement: HTMLPreElement): void {
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
	copyButton.setAttribute('aria-label', T.copyCodeAria(formatLanguageLabel(language)));

	toolbar.appendChild(label);
	toolbar.appendChild(copyButton);
	preElement.replaceWith(wrapper);
	wrapper.appendChild(toolbar);
	wrapper.appendChild(preElement);
}

export async function copyCodeBlock(trigger: HTMLButtonElement): Promise<void> {
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

export async function copyText(text: string): Promise<void> {
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

export function isSafeHref(href: string): boolean {
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

export function setLoading(isLoading: boolean): void {
	state.isBusy = isLoading;
	if (isLoading && state.startAckTimeout) {
		clearTimeout(state.startAckTimeout);
		state.startAckTimeout = null;
	}
	if (isLoading) {
		toolCallSlot.classList.toggle('hidden', state.mainToolStatusSuppressed);
		loading.classList.add('show');
		sendBtn.disabled = false;
		sendBtn.setAttribute('aria-label', 'Cancel');
		sendBtn.title = 'Cancel';
		sendBtn.classList.add('composer-cancel');
		settingsBtn.disabled = true;
		closeSessionDrawer();
		return;
	}
	loading.classList.remove('show');
	toolCallSlot.classList.add('hidden');
	sendBtn.disabled = false;
	sendBtn.setAttribute('aria-label', 'Send');
	sendBtn.title = 'Send';
	sendBtn.classList.remove('composer-cancel');
	settingsBtn.disabled = false;
}

export function scrollChatToBottom(smooth: boolean): void {
	const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
	if (typeof chatBody.scrollTo === 'function') {
		chatBody.scrollTo({ top: chatBody.scrollHeight, behavior });
		return;
	}
	chatBody.scrollTop = chatBody.scrollHeight;
}

export function isChatNearBottom(thresholdPx = CHAT_BOTTOM_STICKY_THRESHOLD_PX): boolean {
	const distanceToBottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight;
	return distanceToBottom <= thresholdPx;
}

export function appendMessage(role: ChatRole, text: string, smoothScrollToBottom = false): HTMLDivElement {
	const el = document.createElement('div');
	el.className = `message ${role}`;
	el.dataset.rawMarkdown = text || '';
	el.innerHTML = renderMarkdown(text || '');
	chatBody.insertBefore(el, toolCallSlot);
	scrollChatToBottom(!!smoothScrollToBottom);
	return el;
}

export function appendWelcomeMessage(): void {
	const el = appendMessage('assistant', DEFAULT_WELCOME_MESSAGE);
	el.dataset.welcomeMessage = 'true';
}

export function removeWelcomeMessage(): void {
	const messages = chatBody.querySelectorAll<HTMLDivElement>('.message.assistant');
	messages.forEach((node) => {
		if (node.dataset.welcomeMessage === 'true') {
			node.remove();
			return;
		}
		const raw = (node.dataset.rawMarkdown || '').trim();
		if (raw && raw === DEFAULT_WELCOME_MESSAGE) {
			node.remove();
			return;
		}
		const text = (node.textContent || '').trim();
		if (text === DEFAULT_WELCOME_MESSAGE) {
			node.remove();
		}
	});
}

export function autoResizePrompt(): void {
	promptInput.style.height = 'auto';
	const maxHeight = 120;
	const nextHeight = Math.min(promptInput.scrollHeight, maxHeight);
	promptInput.style.height = `${nextHeight}px`;
	promptInput.style.overflowY = promptInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

export function setTodoCollapsed(collapsed: boolean): void {
	const distanceToBottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight;
	const shouldStickToBottom = distanceToBottom <= TODO_BOTTOM_STICKY_THRESHOLD_PX;
	state.todoCollapsed = !!collapsed;
	todoPanel.classList.toggle('collapsed', state.todoCollapsed);
	todoToggleBtn.textContent = state.todoCollapsed ? '▸' : '▾';
	todoToggleBtn.setAttribute('aria-expanded', String(!state.todoCollapsed));
	if (!shouldStickToBottom) {
		return;
	}
	requestAnimationFrame(() => {
		chatBody.scrollTop = chatBody.scrollHeight;
	});
}

export function startAssistantMessage(): void {
	if (!state.activeAssistantMessage) {
		state.activeAssistantMessage = appendMessage('assistant', '');
	}
}

// Render the accumulated markdown once and clear any pending frame. Re-rendering
// the full message re-parses/sanitizes/highlights everything, so we coalesce the
// token stream to at most one render per animation frame instead of one per delta.
export function flushAssistantRender(): void {
	if (state.assistantRenderFrame !== null) {
		cancelAnimationFrame(state.assistantRenderFrame);
		state.assistantRenderFrame = null;
	}
	if (!state.activeAssistantMessage) {
		return;
	}
	state.activeAssistantMessage.innerHTML = renderMarkdown(state.activeAssistantMessage.dataset.rawMarkdown || '');
	chatBody.scrollTop = chatBody.scrollHeight;
}

export function appendAssistantDelta(text: string): void {
	startAssistantMessage();
	if (!state.activeAssistantMessage) {
		return;
	}
	state.activeAssistantMessage.dataset.rawMarkdown = (state.activeAssistantMessage.dataset.rawMarkdown || '') + text;
	if (state.assistantRenderFrame === null) {
		state.assistantRenderFrame = requestAnimationFrame(() => {
			state.assistantRenderFrame = null;
			flushAssistantRender();
		});
	}
}

export function finishAssistantMessage(): void {
	// Ensure the final, complete markdown is rendered even if a frame was pending.
	flushAssistantRender();
	if (!state.activeAssistantMessage) {
		appendMessage('assistant', DEFAULT_EMPTY_ASSISTANT_MESSAGE);
		setLoading(false);
		return;
	}
	const raw = state.activeAssistantMessage.dataset.rawMarkdown || '';
	if (!raw.trim()) {
		state.activeAssistantMessage.dataset.rawMarkdown = DEFAULT_EMPTY_ASSISTANT_MESSAGE;
		state.activeAssistantMessage.innerHTML = renderMarkdown(DEFAULT_EMPTY_ASSISTANT_MESSAGE);
	}
	state.activeAssistantMessage = null;
	setLoading(false);
}

export function resetChat(): void {
	chatBody.querySelectorAll('.message').forEach((node) => node.remove());
	chatBody.querySelectorAll('.tool-status').forEach((node) => node.remove());
	chatBody.querySelectorAll('.run-panel').forEach((node) => node.remove());
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
	runPanelEls.clear();
	runPanelProgressCollapsed.clear();
	runPanelProgressTouched.clear();
	runPanelProgressFinalizeTimeouts.forEach((timeoutId) => {
		clearTimeout(timeoutId);
	});
	runPanelProgressFinalizeTimeouts.clear();
	runPanelToolStatusHideTimeouts.forEach((timeoutId) => {
		clearTimeout(timeoutId);
	});
	runPanelToolStatusHideTimeouts.clear();
	runPanelAutoScrollSuppressed.clear();
	renderedRunStates.clear();
	if (state.runPanelClockInterval) {
		clearInterval(state.runPanelClockInterval);
		state.runPanelClockInterval = null;
	}
	state.activeProgressRunId = 0;
	state.assistantSentDelta = false;
	state.cancellationInFlight = false;
	state.transientToolStatusEl = null;
	if (state.assistantRenderFrame !== null) {
		cancelAnimationFrame(state.assistantRenderFrame);
		state.assistantRenderFrame = null;
	}
	appendWelcomeMessage();
	state.activeAssistantMessage = null;
	setLoading(false);
}

export function getRunStatusLabel(status: ChatRunStatus): string {
	if (status === 'running') {
		return T.runStatus.running;
	}
	if (status === 'completed') {
		return T.runStatus.completed;
	}
	if (status === 'cancelled') {
		return T.runStatus.cancelled;
	}
	return T.runStatus.failed;
}

export function normalizeElapsedFallback(text: string): string {
	const normalized = (text || '').trim();
	if (!normalized) {
		return '';
	}
	const matchedSeconds = normalized.match(/([0-9]+(?:\.[0-9]+)?)/);
	if (matchedSeconds?.[1]) {
		return `${matchedSeconds[1]} ${T.durationSuffix}`;
	}
	return normalized;
}

export function formatRunDurationSeconds(durationMs: number, includeFraction: boolean): string {
	const safeDurationMs = Math.max(0, durationMs);
	const seconds = safeDurationMs / 1000;
	if (!includeFraction) {
		return `${Math.floor(seconds)} ${T.durationSuffix}`;
	}
	const precision = seconds < 10 ? 2 : seconds < 60 ? 1 : 0;
	return `${Number(seconds.toFixed(precision)).toString()} ${T.durationSuffix}`;
}

export function getRunDurationLabel(run: ChatRun, now = Date.now()): string {
	if (!Number.isFinite(run.startedAt)) {
		return run.status === 'running' ? '' : normalizeElapsedFallback(run.elapsedText || '');
	}
	if (run.status === 'running') {
		return T.running(formatRunDurationSeconds(now - run.startedAt, false));
	}
	const endedAt = Number.isFinite(run.endedAt) ? (run.endedAt as number) : now;
	return T.took(formatRunDurationSeconds(endedAt - run.startedAt, true));
}

export function getRunMetaText(run: ChatRun, now = Date.now()): string {
	return [getRunStatusLabel(run.status), getRunDurationLabel(run, now)].filter(Boolean).join(' · ');
}

export function refreshRunningRunPanelMeta(): void {
	let hasRunningRun = false;
	const now = Date.now();
	renderedRunStates.forEach((run, runId) => {
		if (run.status !== 'running') {
			return;
		}
		hasRunningRun = true;
		const panel = runPanelEls.get(runId);
		if (!panel?.isConnected) {
			return;
		}
		const meta = panel.querySelector<HTMLDivElement>('.run-panel-meta');
		if (meta) {
			meta.textContent = getRunMetaText(run, now);
		}
	});
	if (!hasRunningRun && state.runPanelClockInterval) {
		clearInterval(state.runPanelClockInterval);
		state.runPanelClockInterval = null;
	}
}

export function syncRunPanelClock(): void {
	const hasRunningRun = Array.from(renderedRunStates.values()).some((run) => run.status === 'running');
	if (hasRunningRun) {
		if (!state.runPanelClockInterval) {
			state.runPanelClockInterval = setInterval(() => {
				refreshRunningRunPanelMeta();
			}, 1000);
		}
		refreshRunningRunPanelMeta();
		return;
	}
	if (state.runPanelClockInterval) {
		clearInterval(state.runPanelClockInterval);
		state.runPanelClockInterval = null;
	}
}

export function findRunInsertionAnchor(runId: string): Element {
	const existingPanel = runPanelEls.get(runId);
	if (existingPanel?.isConnected) {
		return existingPanel;
	}
	return toolCallSlot;
}

export function animateCollapsibleSection(
	element: HTMLDivElement,
	collapsed: boolean,
	expandedMaxHeight: string,
	getIsCollapsed: () => boolean
): void {
	if (collapsed) {
		element.style.maxHeight = `${element.scrollHeight}px`;
		requestAnimationFrame(() => {
			element.classList.add('collapsed');
			element.style.maxHeight = '0px';
		});
		return;
	}

	element.classList.remove('collapsed');
	element.style.maxHeight = '0px';
	requestAnimationFrame(() => {
		element.style.maxHeight = `${element.scrollHeight}px`;
		setTimeout(() => {
			if (!getIsCollapsed()) {
				element.style.maxHeight = expandedMaxHeight;
			}
		}, COLLAPSE_TRANSITION_MS);
	});
}

export function setRunPanelCollapsed(panel: HTMLDivElement, collapsed: boolean): void {
	const body = panel.querySelector<HTMLDivElement>('.run-panel-body');
	const summary = panel.querySelector<HTMLDivElement>('.run-panel-summary');
	const toggle = panel.querySelector<HTMLButtonElement>('.run-panel-toggle');
	if (!body || !summary || !toggle) {
		return;
	}
	const nextCollapsed = !!collapsed;
	const currentCollapsed = body.classList.contains('collapsed');
	panel.classList.toggle('collapsed', nextCollapsed);
	toggle.setAttribute('aria-expanded', String(!nextCollapsed));
	toggle.textContent = nextCollapsed ? T.expand : T.collapse;
	const hasSummaryText = !!summary.textContent?.trim();
	if (currentCollapsed === nextCollapsed) {
		if (nextCollapsed) {
			summary.classList.toggle('show', hasSummaryText);
			body.classList.add('collapsed');
			body.style.maxHeight = '0px';
			return;
		}
		summary.classList.remove('show');
		body.classList.remove('collapsed');
		body.style.maxHeight = 'none';
		return;
	}
	if (nextCollapsed) {
		animateCollapsibleSection(body, true, 'none', () => panel.classList.contains('collapsed'));
		requestAnimationFrame(() => {
			summary.classList.toggle('show', hasSummaryText);
		});
		return;
	}
	summary.classList.remove('show');
	animateCollapsibleSection(body, false, 'none', () => panel.classList.contains('collapsed'));
}

export function getRunPanelProgressNodes(list: HTMLDivElement): HTMLDivElement[] {
	return Array.from(list.querySelectorAll<HTMLDivElement>('.progress-entry'));
}

export function setRunProgressCollapsed(runId: string, collapsed: boolean): void {
	const panel = runPanelEls.get(runId);
	if (!panel) {
		return;
	}
	const list = panel.querySelector<HTMLDivElement>('.run-panel-progress-list');
	const summary = panel.querySelector<HTMLButtonElement>('.run-panel-progress-summary');
	if (!list || !summary) {
		return;
	}
	const nextCollapsed = !!collapsed;
	runPanelProgressCollapsed.set(runId, nextCollapsed);
	const previousTimeout = runPanelProgressFinalizeTimeouts.get(runId);
	if (previousTimeout) {
		clearTimeout(previousTimeout);
		runPanelProgressFinalizeTimeouts.delete(runId);
	}
	const nodes = getRunPanelProgressNodes(list);

	if (!nextCollapsed) {
		nodes.forEach((node) => {
			node.classList.remove('progress-collapsed-done');
			node.style.display = '';
		});
		requestAnimationFrame(() => {
			if (runPanelProgressCollapsed.get(runId)) {
				return;
			}
			nodes.forEach((node) => {
				node.classList.remove('progress-hidden');
			});
		});
	} else {
		nodes.forEach((node) => {
			node.classList.add('progress-hidden');
		});
		const timeoutId = setTimeout(() => {
			if (!runPanelProgressCollapsed.get(runId)) {
				return;
			}
			getRunPanelProgressNodes(list).forEach((node) => {
				node.classList.add('progress-collapsed-done');
				node.style.display = 'none';
			});
		}, COLLAPSE_TRANSITION_MS);
		runPanelProgressFinalizeTimeouts.set(runId, timeoutId);
	}

		list.dataset.collapsed = String(nextCollapsed);
		list.classList.toggle('collapsed', nextCollapsed);
	summary.classList.toggle('expanded', !nextCollapsed);
		summary.setAttribute('aria-expanded', String(!nextCollapsed));
	summary.textContent = nextCollapsed
		? T.progressCollapsed(nodes.length)
		: T.progressExpanded(nodes.length);
}

export function createRunPanel(run: ChatRun): HTMLDivElement {
	const panel = document.createElement('div');
	panel.className = 'run-panel';
	panel.dataset.runId = run.id;

	const header = document.createElement('div');
	header.className = 'run-panel-header';

	const titleWrap = document.createElement('div');
	titleWrap.className = 'run-panel-title-wrap';
	const title = document.createElement('div');
	title.className = 'run-panel-title';
	const meta = document.createElement('div');
	meta.className = 'run-panel-meta';
	titleWrap.appendChild(title);
	titleWrap.appendChild(meta);

	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.className = 'run-panel-toggle';
	toggle.textContent = T.collapse;
	toggle.addEventListener('click', (event) => {
		event.stopPropagation();
		const nextCollapsed = !panel.classList.contains('collapsed');
		runPanelAutoScrollSuppressed.add(run.id);
		setRunPanelCollapsed(panel, nextCollapsed);
		vscode.postMessage({ type: 'chat:toggleRunCollapsed', runId: run.id, collapsed: nextCollapsed });
	});

	header.appendChild(titleWrap);
	header.appendChild(toggle);

	const summary = document.createElement('div');
	summary.className = 'run-panel-summary';

	const body = document.createElement('div');
	body.className = 'run-panel-body';

	const toolSlot = document.createElement('div');
	toolSlot.className = 'tool-call-slot transient-tool-status run-panel-tool-slot hidden empty';

	const progressSummary = document.createElement('button');
	progressSummary.type = 'button';
	progressSummary.className = 'progress-summary run-panel-progress-summary';
	progressSummary.addEventListener('click', () => {
		runPanelProgressTouched.add(run.id);
		const current = !!runPanelProgressCollapsed.get(run.id);
		setRunProgressCollapsed(run.id, !current);
	});

	const progressList = document.createElement('div');
	progressList.className = 'run-panel-progress-list';

	const assistant = document.createElement('div');
	assistant.className = 'message assistant run-panel-assistant';

	const metaList = document.createElement('div');
	metaList.className = 'run-panel-meta-list';

	body.appendChild(progressSummary);
	body.appendChild(progressList);
	body.appendChild(assistant);
	body.appendChild(metaList);
	body.appendChild(toolSlot);

	panel.appendChild(header);
	panel.appendChild(summary);
	panel.appendChild(body);
	runPanelEls.set(run.id, panel);
	chatBody.insertBefore(panel, toolCallSlot);
	return panel;
}

export function setMainToolStatusSuppressed(suppressed: boolean): void {
	state.mainToolStatusSuppressed = !!suppressed;
	if (state.mainToolStatusSuppressed) {
		clearTransientToolStatus(true);
		toolCallSlot.classList.add('hidden');
		return;
	}
	if (state.isBusy) {
		toolCallSlot.classList.add('hidden');
	}
}

export function keepRunPanelTransientToolStatusAtBottom(runId: string): void {
	const panel = runPanelEls.get(runId);
	if (!panel) {
		return;
	}
	const body = panel.querySelector<HTMLDivElement>('.run-panel-body');
	const toolSlot = panel.querySelector<HTMLDivElement>('.run-panel-tool-slot');
	if (!body || !toolSlot) {
		return;
	}
	body.appendChild(toolSlot);
}

export function clearRunPanelTransientToolStatus(runId: string, immediate = false, keepVisible = false): void {
	const panel = runPanelEls.get(runId);
	if (!panel) {
		return;
	}
	const toolSlot = panel.querySelector<HTMLDivElement>('.run-panel-tool-slot');
	if (!toolSlot) {
		return;
	}
	const previousTimeout = runPanelToolStatusHideTimeouts.get(runId);
	const nextClearMode = keepVisible ? 'keep' : 'hide';
	if (previousTimeout) {
		if (!immediate && runPanelToolStatusClearModes.get(runId) === nextClearMode) {
			return;
		}
		clearTimeout(previousTimeout);
		runPanelToolStatusHideTimeouts.delete(runId);
	}
	runPanelToolStatusClearModes.set(runId, nextClearMode);
	const finalize = () => {
		if (keepVisible) {
			toolSlot.classList.remove('hidden');
			keepRunPanelTransientToolStatusAtBottom(runId);
		} else {
			toolSlot.classList.add('hidden');
		}
		toolSlot.classList.add('empty');
		toolSlot.classList.remove('tool-status-fade-out');
		toolSlot.textContent = '';
	};
	if (immediate || !toolSlot.textContent?.trim()) {
		finalize();
		return;
	}
	const timeoutId = setTimeout(() => {
		toolSlot.classList.add('tool-status-fade-out');
		const fadeTimeoutId = setTimeout(() => {
			finalize();
			runPanelToolStatusHideTimeouts.delete(runId);
		}, 220);
		runPanelToolStatusHideTimeouts.set(runId, fadeTimeoutId);
	}, 1500);
	runPanelToolStatusHideTimeouts.set(runId, timeoutId);
}

export function setRunPanelTransientToolStatus(runId: string, text: string): void {
	const panel = runPanelEls.get(runId);
	if (!panel) {
		return;
	}
	const toolSlot = panel.querySelector<HTMLDivElement>('.run-panel-tool-slot');
	if (!toolSlot) {
		return;
	}
	const previousTimeout = runPanelToolStatusHideTimeouts.get(runId);
	if (previousTimeout) {
		clearTimeout(previousTimeout);
		runPanelToolStatusHideTimeouts.delete(runId);
	}
	runPanelToolStatusClearModes.delete(runId);
	if (toolSlot.textContent === text && !toolSlot.classList.contains('hidden')) {
		keepRunPanelTransientToolStatusAtBottom(runId);
		toolSlot.classList.remove('tool-status-fade-out');
		toolSlot.classList.remove('empty');
		return;
	}
	keepRunPanelTransientToolStatusAtBottom(runId);
	toolSlot.classList.remove('hidden');
	toolSlot.classList.remove('empty');
	toolSlot.classList.remove('tool-status-fade-out');
	toolSlot.classList.remove('tool-status-switch');
	toolSlot.textContent = text;
	void toolSlot.offsetWidth;
	toolSlot.classList.add('tool-status-switch');
}

export function renderRunPanel(run: ChatRun): void {
	const shouldStickToBottom = isChatNearBottom();
	const suppressAutoScroll = runPanelAutoScrollSuppressed.delete(run.id);
	const existingPanel = runPanelEls.get(run.id);
	renderedRunStates.set(run.id, run);
	if (!existingPanel && state.activeProgressRunId) {
		setProgressRunCollapsed(state.activeProgressRunId, true);
		state.activeProgressRunId = 0;
	}
	const panel = existingPanel ?? createRunPanel(run);
	const title = panel.querySelector<HTMLDivElement>('.run-panel-title');
	const meta = panel.querySelector<HTMLDivElement>('.run-panel-meta');
	const toggle = panel.querySelector<HTMLButtonElement>('.run-panel-toggle');
	const summary = panel.querySelector<HTMLDivElement>('.run-panel-summary');
	const toolSlot = panel.querySelector<HTMLDivElement>('.run-panel-tool-slot');
	const progressSummary = panel.querySelector<HTMLButtonElement>('.run-panel-progress-summary');
	const progressList = panel.querySelector<HTMLDivElement>('.run-panel-progress-list');
	const assistant = panel.querySelector<HTMLDivElement>('.run-panel-assistant');
	const metaList = panel.querySelector<HTMLDivElement>('.run-panel-meta-list');
	if (!title || !meta || !toggle || !summary || !toolSlot || !progressSummary || !progressList || !assistant || !metaList) {
		return;
	}

	title.textContent = run.title || 'Sub Agent';
	meta.textContent = getRunMetaText(run);
	toggle.textContent = run.collapsed ? T.expand : T.collapse;
	summary.textContent = '';
	summary.classList.remove('show');

	if (run.transientToolStatusText) {
		setRunPanelTransientToolStatus(run.id, run.transientToolStatusText);
	} else {
		clearRunPanelTransientToolStatus(run.id, false, run.status === 'running');
	}

	const progressEvents = run.events.filter((event) => event.kind === 'progress');
	const autoCollapseProgress = !!(
		run.activeAssistantText.trim() || run.finalAssistantText.trim() || run.status !== 'running'
	);
	if (!runPanelProgressTouched.has(run.id)) {
		runPanelProgressCollapsed.set(run.id, autoCollapseProgress);
	}
	const progressCollapsed = runPanelProgressCollapsed.get(run.id) ?? autoCollapseProgress;
	const progressSignature = progressEvents.map((event) => event.id).join('|');
	if (progressList.dataset.signature !== progressSignature) {
		const previousProgressIds = new Set((progressList.dataset.signature || '').split('|').filter(Boolean));
		progressList.dataset.signature = progressSignature;
		progressList.replaceChildren(
			...progressEvents.map((event) => {
				const el = document.createElement('div');
				el.className = 'tool-status progress-entry';
				el.textContent = event.text || '';
				if (!progressCollapsed && !previousProgressIds.has(event.id)) {
					el.classList.add('progress-entry-appear');
				}
				if (progressCollapsed) {
					el.classList.add('progress-hidden', 'progress-collapsed-done');
					el.style.display = 'none';
				}
				return el;
			})
		);
	}
	progressSummary.style.display = progressEvents.length > 0 ? '' : 'none';
	setRunProgressCollapsed(run.id, progressCollapsed);

	const assistantText = run.finalAssistantText || run.activeAssistantText;
	assistant.style.display = assistantText ? '' : 'none';
	assistant.dataset.rawMarkdown = assistantText || '';
	assistant.innerHTML = assistantText ? renderMarkdown(assistantText) : '';

	metaList.innerHTML = '';
	run.events
		.filter((event) => event.kind === 'elapsed' || event.kind === 'error')
		.forEach((event) => {
			const el = document.createElement('div');
			el.className = `tool-status elapsed-status${event.kind === 'error' ? ' run-panel-error' : ''}`;
			el.textContent = event.text || '';
			metaList.appendChild(el);
		});

	setRunPanelCollapsed(panel, run.collapsed);
	keepRunPanelTransientToolStatusAtBottom(run.id);
	const insertionAnchor = findRunInsertionAnchor(run.id);
	if (insertionAnchor !== panel) {
		chatBody.insertBefore(panel, insertionAnchor);
	}
	keepTransientToolStatusAtBottom();
	if (!suppressAutoScroll && shouldStickToBottom) {
		scrollChatToBottom(false);
	}
	syncRunPanelClock();
}

export function getProgressRunNodes(runId: number): HTMLDivElement[] {
	const nodes = progressRunNodes.get(runId) || [];
	const activeNodes = nodes.filter((node) => !!node && node.isConnected);
	if (activeNodes.length !== nodes.length) {
		progressRunNodes.set(runId, activeNodes);
	}
	return activeNodes;
}

export function keepTransientToolStatusAtBottom(): void {
	chatBody.insertBefore(toolCallSlot, loading);
}

export function ensureProgressRunSummary(runId: number): HTMLButtonElement {
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

export function setProgressRunCollapsed(runId: number, collapsed: boolean): void {
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
		? T.progressCollapsed(nodes.length)
		: T.progressExpanded(nodes.length);
}

export function renderTodos(todos: ChatTodo[]): void {
	state.todosState = Array.isArray(todos) ? todos : [];
	todoList.innerHTML = '';
	if (state.todosState.length === 0) {
		todoPanel.classList.remove('show');
		composerShell.classList.remove('has-todos');
		todoSummary.textContent = '';
		setTodoCollapsed(state.todoCollapsed);
		return;
	}

	const doneCount = state.todosState.filter((todo) => !!todo.completed).length;
	todoSummary.textContent = `${doneCount}/${state.todosState.length} completed`;
	todoPanel.classList.add('show');
	composerShell.classList.add('has-todos');
	setTodoCollapsed(state.todoCollapsed);

	state.todosState.forEach((todo, index) => {
		const row = document.createElement('div');
		row.className = `todo-item${todo.completed ? ' done' : ''}`;
		const marker = document.createElement('span');
		marker.className = 'todo-marker';
		marker.textContent = todo.completed ? '✓' : '○';
		const text = document.createElement('span');
		text.className = 'todo-text';
		text.textContent = todo.text || '';
		row.appendChild(marker);
		row.appendChild(text);
		todoList.appendChild(row);
	});
}

export function sendMessage(): void {
	if (state.isBusy) {
		state.cancellationInFlight = true;
		vscode.postMessage({ type: 'chat:cancelGeneration' });
		return;
	}

	const text = promptInput.value.trim();
	if (!text || sendBtn.disabled) {
		return;
	}

	removeWelcomeMessage();
	appendMessage('user', text, true);
	promptInput.value = '';
	autoResizePrompt();
	vscode.postMessage({ type: 'chat:userMessage', text });
	if (state.startAckTimeout) {
		clearTimeout(state.startAckTimeout);
	}
	state.startAckTimeout = setTimeout(() => {
		if (!state.isBusy) {
			appendMessage('assistant', T.requestNotProcessed);
		}
	}, 5000);
}

export function getDrawerFocusable(): HTMLElement[] {
	const selector = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';
	return Array.from(sessionDrawer.querySelectorAll<HTMLElement>(selector)).filter(
		(el) => !el.hasAttribute('disabled') && el.offsetParent !== null
	);
}

export function openSessionDrawer(): void {
	sessionDrawer.classList.add('open');
	sessionDrawerOverlay.classList.add('open');
	sessionDrawer.setAttribute('aria-hidden', 'false');
	chatTitleBtn.setAttribute('aria-expanded', 'true');
	setTimeout(() => drawerSearch.focus(), 50);
}

export function closeSessionDrawer(): void {
	const wasOpen = sessionDrawer.classList.contains('open');
	sessionDrawer.classList.remove('open');
	sessionDrawerOverlay.classList.remove('open');
	sessionDrawer.setAttribute('aria-hidden', 'true');
	chatTitleBtn.setAttribute('aria-expanded', 'false');
	state.editingSessionId = '';
	drawerSearch.value = '';
	filterSessions('');
	// Return focus to the trigger when the user dismissed an open drawer.
	if (wasOpen && document.activeElement !== document.body) {
		chatTitleBtn.focus();
	}
}

export function toggleSessionDrawer(): void {
	if (sessionDrawer.classList.contains('open')) {
		closeSessionDrawer();
		return;
	}
	openSessionDrawer();
}

export function filterSessions(query: string): void {
	const q = query.trim().toLowerCase();
	sessionList.querySelectorAll<HTMLDivElement>('.session-card').forEach((card) => {
		const title = (card.dataset.title || '').toLowerCase();
		card.style.display = !q || title.includes(q) ? '' : 'none';
	});
}

export function renderSessions(sessions: ChatSession[], activeSessionId: string): void {
	state.sessionsState = Array.isArray(sessions) ? sessions : [];
	sessionList.innerHTML = '';
	state.currentSessionId = activeSessionId || '';

	state.sessionsState.forEach((session) => {
		const row = document.createElement('div');
		row.className = `session-card${session.id === state.currentSessionId ? ' active' : ''}`;
		row.dataset.title = (session.title || '').toLowerCase();

		if (state.editingSessionId === session.id) {
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
				if (state.isBusy) {
					return;
				}
				const title = input.value.trim();
				if (!title) {
					input.focus();
					return;
				}
				state.editingSessionId = '';
				vscode.postMessage({ type: 'chat:renameSession', sessionId: session.id, title });
			});

			const cancelBtn = document.createElement('button');
			cancelBtn.type = 'button';
			cancelBtn.className = 'session-tool';
			cancelBtn.textContent = 'Cancel';
			cancelBtn.addEventListener('click', () => {
				state.editingSessionId = '';
				renderSessions(state.sessionsState, state.currentSessionId);
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
			sessionList.appendChild(row);
			setTimeout(() => input.focus(), 0);
			return;
		}

		const item = document.createElement('button');
		item.type = 'button';
		item.className = 'session-card-main';
		item.textContent = session.title || 'New Chat';
		item.addEventListener('click', () => {
			if (state.isBusy || !session.id || session.id === state.currentSessionId) {
				return;
			}
			closeSessionDrawer();
			vscode.postMessage({ type: 'chat:switchSession', sessionId: session.id });
		});

		const toolWrap = document.createElement('div');
		toolWrap.className = 'session-item-tools';

		const renameBtn = document.createElement('button');
		renameBtn.type = 'button';
		renameBtn.className = 'session-tool';
		renameBtn.textContent = 'Rename';
		renameBtn.addEventListener('click', () => {
			if (state.isBusy || !session.id) {
				return;
			}
			state.editingSessionId = session.id;
			renderSessions(state.sessionsState, state.currentSessionId);
		});

		const deleteBtn = document.createElement('button');
		deleteBtn.type = 'button';
		deleteBtn.className = 'session-tool';
		deleteBtn.textContent = 'Delete';
		deleteBtn.addEventListener('click', () => {
			if (state.isBusy || !session.id) {
				return;
			}
			vscode.postMessage({ type: 'chat:deleteSession', sessionId: session.id });
		});

		toolWrap.appendChild(renameBtn);
		toolWrap.appendChild(deleteBtn);
		row.appendChild(item);
		row.appendChild(toolWrap);
		sessionList.appendChild(row);
	});

	const active = sessions.find((session) => session.id === state.currentSessionId);
	const activeTitle = (active && active.title) || 'New Chat';
	chatTitle.textContent = activeTitle;
	if (activeSessionLabel) {
		activeSessionLabel.textContent = activeTitle;
	}
	filterSessions(drawerSearch.value);
}

export function clearTransientToolStatus(forceHide = false): void {
	if (state.transientToolStatusHideTimeout) {
		clearTimeout(state.transientToolStatusHideTimeout);
		state.transientToolStatusHideTimeout = null;
	}
	toolCallSlot.classList.add('empty');
	toolCallSlot.classList.remove('tool-status-fade-out');
	toolCallSlot.textContent = '';
	state.transientToolStatusEl = null;
	if (!state.isBusy || forceHide || state.mainToolStatusSuppressed) {
		toolCallSlot.classList.add('hidden');
	}
}

export function fadeTransientToolStatus(): void {
	if (!state.transientToolStatusEl) {
		return;
	}
	if (state.transientToolStatusHideTimeout) {
		clearTimeout(state.transientToolStatusHideTimeout);
	}
	const active = state.transientToolStatusEl;
	state.transientToolStatusHideTimeout = setTimeout(() => {
		if (state.transientToolStatusEl !== active) {
			return;
		}
		toolCallSlot.classList.add('tool-status-fade-out');
		state.transientToolStatusHideTimeout = setTimeout(() => {
			if (state.transientToolStatusEl === active) {
				clearTransientToolStatus();
			}
		}, 220);
	}, 1500);
}

export function appendTransientToolStatus(text: string): void {
	if (state.mainToolStatusSuppressed) {
		return;
	}
	state.transientToolStatusEl = toolCallSlot;
	keepTransientToolStatusAtBottom();

	if (state.transientToolStatusHideTimeout) {
		clearTimeout(state.transientToolStatusHideTimeout);
		state.transientToolStatusHideTimeout = null;
	}

	toolCallSlot.classList.remove('hidden');
	toolCallSlot.classList.remove('empty');
	toolCallSlot.classList.remove('tool-status-fade-out');
	toolCallSlot.classList.remove('tool-status-switch');
	toolCallSlot.textContent = text;
	void toolCallSlot.offsetWidth;
	toolCallSlot.classList.add('tool-status-switch');
	state.activeAssistantMessage = null;
	chatBody.scrollTop = chatBody.scrollHeight;
}

export function appendToolStatus(text: string, transient: boolean): void {
	if (state.mainToolStatusSuppressed) {
		return;
	}
	if (transient) {
		appendTransientToolStatus(text);
		return;
	}
	if (!state.activeProgressRunId) {
		state.activeProgressRunId = state.nextProgressRunId;
		state.nextProgressRunId += 1;
	}
	const el = document.createElement('div');
	el.className = 'tool-status progress-entry';
	el.textContent = text;
	el.classList.add('progress-entry-appear');
	el.dataset.progressRunId = String(state.activeProgressRunId);
	const runNodes = progressRunNodes.get(state.activeProgressRunId) || [];
	runNodes.push(el);
	progressRunNodes.set(state.activeProgressRunId, runNodes);
	chatBody.insertBefore(el, toolCallSlot);
	keepTransientToolStatusAtBottom();
	state.activeAssistantMessage = null;
	setProgressRunCollapsed(state.activeProgressRunId, false);
	chatBody.scrollTop = chatBody.scrollHeight;
}

export function appendElapsedStatus(text: string): void {
	const el = document.createElement('div');
	el.className = 'tool-status elapsed-status';
	el.textContent = text;
	el.classList.add('progress-entry-appear');
	chatBody.insertBefore(el, toolCallSlot);
	keepTransientToolStatusAtBottom();
	chatBody.scrollTop = chatBody.scrollHeight;
}

export function appendHistoricalStatus(text: string, kind: ChatStatusEntry['kind'], runId: number): void {
	if (kind === 'elapsed') {
		const el = document.createElement('div');
		el.className = 'tool-status elapsed-status';
		el.textContent = text;
		chatBody.insertBefore(el, toolCallSlot);
		keepTransientToolStatusAtBottom();
		return;
	}

	const normalizedRunId = Number.isFinite(runId) && runId > 0 ? runId : state.nextProgressRunId++;
	state.nextProgressRunId = Math.max(state.nextProgressRunId, normalizedRunId + 1);
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

export function renderSessionState(viewState: ChatSessionViewState | null): void {
	resetChat();
	if (!viewState || typeof viewState !== 'object') {
		return;
	}

	const timeline = Array.isArray(viewState.timeline) ? viewState.timeline : [];
	const runs = new Map((Array.isArray(viewState.runs) ? viewState.runs : []).map((run) => [run.id, run]));
	const hasUserMessage = timeline.some((entry) => entry.kind === 'message' && entry.role === 'user');
	if (hasUserMessage) {
		removeWelcomeMessage();
	}
	timeline.forEach((entry) => {
		if (entry.kind === 'message') {
			appendMessage(entry.role === 'user' ? 'user' : 'assistant', entry.text || '');
			return;
		}
		if (entry.kind === 'run') {
			const run = runs.get(entry.runId || '');
			if (run) {
				renderRunPanel(run);
			}
			return;
		}
		appendHistoricalStatus(entry.text || '', entry.statusKind || 'progress', Number(entry.runId));
	});

	const isGenerating = !!viewState.isGenerating;
	const activeAssistantText = typeof viewState.activeAssistantText === 'string' ? viewState.activeAssistantText : '';
	const activeRunId = Number(viewState.activeRunId);
	Array.from(progressRunNodes.keys())
		.sort((left, right) => left - right)
		.forEach((runId) => {
			const shouldCollapse = !isGenerating || runId !== activeRunId || !!activeAssistantText;
			setProgressRunCollapsed(runId, shouldCollapse);
		});
	if (isGenerating) {
		if (Number.isFinite(activeRunId) && activeRunId > 0) {
			state.activeProgressRunId = activeRunId;
			state.nextProgressRunId = Math.max(state.nextProgressRunId, activeRunId + 1);
		} else {
			state.activeProgressRunId = state.nextProgressRunId;
			state.nextProgressRunId += 1;
		}
		if (activeAssistantText) {
			state.activeAssistantMessage = appendMessage('assistant', activeAssistantText);
		}
		setLoading(true);
		return;
	}

	state.activeProgressRunId = 0;
	state.activeAssistantMessage = null;
	setLoading(false);
}
