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
import {
	renderMarkdown,
	sanitizeLanguageLabel,
	formatLanguageLabel,
	enhanceCodeBlock,
	copyCodeBlock,
	copyText,
	isSafeHref,
	setLoading,
	scrollChatToBottom,
	isChatNearBottom,
	appendMessage,
	appendWelcomeMessage,
	removeWelcomeMessage,
	autoResizePrompt,
	setTodoCollapsed,
	startAssistantMessage,
	flushAssistantRender,
	appendAssistantDelta,
	finishAssistantMessage,
	getRunStatusLabel,
	normalizeElapsedFallback,
	formatRunDurationSeconds,
	getRunDurationLabel,
	getRunMetaText,
	refreshRunningRunPanelMeta,
	syncRunPanelClock,
	findRunInsertionAnchor,
	animateCollapsibleSection,
	setRunPanelCollapsed,
	getRunPanelProgressNodes,
	setRunProgressCollapsed,
	createRunPanel,
	setMainToolStatusSuppressed,
	keepRunPanelTransientToolStatusAtBottom,
	clearRunPanelTransientToolStatus,
	setRunPanelTransientToolStatus,
	renderRunPanel,
	getProgressRunNodes,
	keepTransientToolStatusAtBottom,
	ensureProgressRunSummary,
	setProgressRunCollapsed,
	renderTodos,
	sendMessage,
	getDrawerFocusable,
	openSessionDrawer,
	closeSessionDrawer,
	toggleSessionDrawer,
	filterSessions,
	renderSessions,
	clearTransientToolStatus,
	fadeTransientToolStatus,
	appendTransientToolStatus,
	appendToolStatus,
	appendElapsedStatus,
	appendHistoricalStatus,
	renderSessionState
} from './render.js';

// Suppress CSS transitions on page load so the drawer's initial translateX(100%)
// is applied instantly (no "slide out" flash on startup).
sessionDrawer.style.transition = 'none';
sessionDrawerOverlay.style.transition = 'none';
requestAnimationFrame(() => requestAnimationFrame(() => {
	sessionDrawer.style.transition = '';
	sessionDrawerOverlay.style.transition = '';
}));

sendBtn.addEventListener('click', sendMessage);
todoToggleBtn.addEventListener('click', () => {
	setTodoCollapsed(!state.todoCollapsed);
});
settingsBtn.addEventListener('click', () => {
	if (state.isBusy) {
		return;
	}
	vscode.postMessage({ type: 'chat:openSettings' });
});
chatTitleBtn.addEventListener('click', () => {
	if (!state.isBusy) {
		toggleSessionDrawer();
	}
});
headerNewChatBtn.addEventListener('click', () => {
	if (state.isBusy) {
		return;
	}
	closeSessionDrawer();
	vscode.postMessage({ type: 'chat:newSession' });
});
sessionDrawerOverlay.addEventListener('click', () => {
	closeSessionDrawer();
});
// Trap Tab within the drawer while it is open (modal dialog semantics).
sessionDrawer.addEventListener('keydown', (event) => {
	if (event.key !== 'Tab' || !sessionDrawer.classList.contains('open')) {
		return;
	}
	const focusable = getDrawerFocusable();
	if (focusable.length === 0) {
		return;
	}
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	const active = document.activeElement as HTMLElement | null;
	if (event.shiftKey && (active === first || !sessionDrawer.contains(active))) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && active === last) {
		event.preventDefault();
		first.focus();
	}
});
document.addEventListener('keydown', (event) => {
	if (event.key !== 'Escape') {
		return;
	}
	closeSessionDrawer();
});
drawerSearch.addEventListener('input', () => {
	filterSessions(drawerSearch.value);
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

window.addEventListener('message', (event: MessageEvent<WebviewMessage>) => {
	const message = event.data || {};
	if (message.type === 'chat:assistantStart') {
		state.activeAssistantMessage = null;
		clearTransientToolStatus();
		state.activeProgressRunId = state.nextProgressRunId;
		state.nextProgressRunId += 1;
		state.assistantSentDelta = false;
		state.cancellationInFlight = false;
		setLoading(true);
	}
	if (message.type === 'chat:assistantDelta') {
		if (state.activeProgressRunId && !state.cancellationInFlight) {
			setProgressRunCollapsed(state.activeProgressRunId, true);
		}
		state.assistantSentDelta = true;
		if (!state.cancellationInFlight) {
			state.activeProgressRunId = 0;
		}
		appendAssistantDelta(message.text || '');
	}
	if (message.type === 'chat:assistantDone') {
		if (state.cancellationInFlight) {
			fadeTransientToolStatus();
		} else {
			clearTransientToolStatus();
		}
		if (!state.assistantSentDelta && state.activeProgressRunId && !state.cancellationInFlight) {
			setProgressRunCollapsed(state.activeProgressRunId, true);
		}
		state.activeProgressRunId = 0;
		state.assistantSentDelta = false;
		state.cancellationInFlight = false;
		finishAssistantMessage();
	}
	if (message.type === 'chat:toolStatus') {
		appendToolStatus(message.text || '', !!message.transient);
	}
	if (message.type === 'chat:toolStatusDone') {
		fadeTransientToolStatus();
	}
	if (message.type === 'chat:toolStatusSuspend') {
		setMainToolStatusSuppressed(true);
	}
	if (message.type === 'chat:toolStatusResume') {
		setMainToolStatusSuppressed(false);
	}
	if (message.type === 'chat:elapsed') {
		appendElapsedStatus(message.text || '');
	}
	if (message.type === 'chat:error') {
		if (state.activeAssistantMessage && !(state.activeAssistantMessage.dataset.rawMarkdown || '').trim()) {
			const fallback = message.text || T.requestFailed;
			state.activeAssistantMessage.dataset.rawMarkdown = fallback;
			state.activeAssistantMessage.innerHTML = renderMarkdown(fallback);
		} else {
			appendMessage('assistant', message.text || T.requestFailed);
		}
		setLoading(false);
	}
	if (message.type === 'chat:sessions') {
		renderSessions(message.sessions || [], message.currentSessionId || '');
	}
	if (message.type === 'chat:sessionState') {
		if (message.sessionId === state.currentSessionId) {
			renderSessionState(message.state || null);
		}
	}
	if (message.type === 'chat:runState') {
		if (message.sessionId === state.currentSessionId && message.run) {
			renderRunPanel(message.run);
		}
	}
	if (message.type === 'chat:todos') {
		if (message.sessionId === state.currentSessionId) {
			renderTodos(message.todos || []);
		}
	}
	if (message.type === 'chat:externalUserMessage') {
		appendMessage('user', message.text || '');
	}
});

vscode.postMessage({ type: 'chat:ready' });
