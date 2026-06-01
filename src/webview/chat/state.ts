// View-state, shared DOM references and the VS Code bridge for the chat webview.
// render.ts and view.ts both import the single mutable `state` object plus the
// const collections here, so mutations are visible across the bundle.

export type ChatRole = 'user' | 'assistant';

export type ChatSession = {
	id: string;
	title: string;
	createdAt: number;
};

export type ChatTodo = {
	id: string;
	text: string;
	completed: boolean;
	createdAt: number;
	completedAt?: number;
};

export type RenderableMessage = {
	role: ChatRole;
	text: string;
};

export type ChatRunKind = 'subagent' | 'code_review';

export type ChatRunStatus = 'running' | 'completed' | 'error' | 'cancelled';

export type ChatRunEventKind = 'progress' | 'tool' | 'elapsed' | 'error';

export type ChatRunEvent = {
	id: string;
	kind: ChatRunEventKind;
	text: string;
	createdAt: number;
	transient?: boolean;
	status?: 'started' | 'finished';
	toolName?: string;
};

export type ChatRun = {
	id: string;
	title: string;
	kind: ChatRunKind;
	status: ChatRunStatus;
	createdAt: number;
	startedAt: number;
	endedAt?: number;
	elapsedText?: string;
	parentRunId?: string;
	collapsed: boolean;
	autoCollapse: boolean;
	transientToolStatusText: string;
	activeAssistantText: string;
	finalAssistantText: string;
	events: ChatRunEvent[];
};

export type ChatStatusEntry = {
	kind: 'progress' | 'elapsed';
	text: string;
	runId: number;
	createdAt: number;
};

export type ChatSessionViewState = {
	timeline: ChatTimelineEntry[];
	runs: ChatRun[];
	isGenerating: boolean;
	activeAssistantText: string;
	activeRunId: number;
};

export type ChatTimelineEntry =
	| {
		kind: 'message';
		role: ChatRole;
		text: string;
		createdAt: number;
	}
	| {
		kind: 'run';
		runId: string;
		createdAt: number;
	}
	| {
		kind: 'status';
		statusKind: ChatStatusEntry['kind'];
		text: string;
		runId: number;
		createdAt: number;
	};

export type WebviewMessage = {
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
	run?: ChatRun;
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
	collapsed?: boolean;
};

declare function acquireVsCodeApi(): {
	postMessage(message: unknown): void;
	setState?(state: unknown): void;
	getState?(): unknown;
};

export const DEFAULT_WELCOME_MESSAGE =
	'What would you like to build today? Paste your requirements, errors, or related code; I will first read the project context and synchronize the current progress in the chat area, then give you the next actionable step.';
export const DEFAULT_EMPTY_ASSISTANT_MESSAGE = 'I have not generated any displayable text response yet.';
export const CHAT_BOTTOM_STICKY_THRESHOLD_PX = 120;
export const TODO_BOTTOM_STICKY_THRESHOLD_PX = 120;
export const COLLAPSE_TRANSITION_MS = 240;

// User-facing strings, centralized for easy future localization.
export const T = {
	runStatus: { running: 'Running', completed: 'Done', cancelled: 'Cancelled', failed: 'Failed' },
	durationSuffix: 's',
	running: (duration: string) => `${duration} elapsed`,
	took: (duration: string) => `Took ${duration}`,
	expand: 'Expand',
	collapse: 'Collapse',
	progressCollapsed: (count: number) => `Progress (${count}) — click to expand`,
	progressExpanded: (count: number) => `Progress (${count}) — click to collapse`,
	requestNotProcessed: 'Request was not processed. Please try again.',
	requestFailed: 'Request failed',
	copyCodeAria: (language: string) => `Copy ${language} code block`
} as const;

export const vscode = acquireVsCodeApi();

export function requireElement<T extends Element>(selector: string): T {
	const element = document.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Missing required element: ${selector}`);
	}
	return element;
}

export const chatTitleBtn = requireElement<HTMLButtonElement>('#chatTitleBtn');
export const headerNewChatBtn = requireElement<HTMLButtonElement>('#headerNewChatBtn');
export const chatTitle = requireElement<HTMLSpanElement>('#chatTitle');
export const chatBody = requireElement<HTMLDivElement>('#chatBody');
export const promptInput = requireElement<HTMLTextAreaElement>('#prompt');
export const settingsBtn = requireElement<HTMLButtonElement>('#settingsBtn');
export const sendBtn = requireElement<HTMLButtonElement>('#sendBtn');
export const composerShell = requireElement<HTMLDivElement>('#composerShell');
export const todoPanel = requireElement<HTMLDivElement>('#todoPanel');
export const todoToggleBtn = requireElement<HTMLButtonElement>('#todoToggleBtn');
export const todoList = requireElement<HTMLDivElement>('#todoList');
export const todoSummary = requireElement<HTMLSpanElement>('#todoSummary');
export const sessionDrawer = requireElement<HTMLDivElement>('#sessionDrawer');
export const sessionDrawerOverlay = requireElement<HTMLDivElement>('#sessionDrawerOverlay');
export const drawerSearch = requireElement<HTMLInputElement>('#drawerSearch');
export const sessionList = requireElement<HTMLDivElement>('#sessionList');
export const activeSessionLabel = document.querySelector<HTMLDivElement>('#activeSessionLabel');
export const toolCallSlot = requireElement<HTMLDivElement>('#toolCallSlot');
export const loading = requireElement<HTMLDivElement>('#loading');

// Single mutable view-state object shared by render.ts and view.ts. Module-level
// `let` bindings cannot be mutated across ES module boundaries, so they live as
// fields here instead.
export const state = {
	activeAssistantMessage: null as HTMLDivElement | null,
	assistantRenderFrame: null as number | null,
	currentSessionId: '',
	isBusy: false,
	sessionsState: [] as ChatSession[],
	todosState: [] as ChatTodo[],
	editingSessionId: '',
	startAckTimeout: null as ReturnType<typeof setTimeout> | null,
	transientToolStatusEl: null as HTMLDivElement | null,
	transientToolStatusHideTimeout: null as ReturnType<typeof setTimeout> | null,
	nextProgressRunId: 1,
	activeProgressRunId: 0,
	assistantSentDelta: false,
	cancellationInFlight: false,
	todoCollapsed: false,
	mainToolStatusSuppressed: false,
	runPanelClockInterval: null as ReturnType<typeof setInterval> | null
};

export const progressRunNodes = new Map<number, HTMLDivElement[]>();
export const progressRunSummaryEls = new Map<number, HTMLButtonElement>();
export const progressRunCollapsed = new Map<number, boolean>();
export const progressRunFinalizeTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
export const runPanelEls = new Map<string, HTMLDivElement>();
export const runPanelProgressCollapsed = new Map<string, boolean>();
export const runPanelProgressTouched = new Set<string>();
export const runPanelProgressFinalizeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
export const runPanelToolStatusHideTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
export const runPanelToolStatusClearModes = new Map<string, 'keep' | 'hide'>();
export const runPanelAutoScrollSuppressed = new Set<string>();
export const renderedRunStates = new Map<string, ChatRun>();
