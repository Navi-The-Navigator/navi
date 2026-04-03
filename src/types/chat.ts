export type ChatInboundMessage = {
	type?: string;
	text?: string;
	sessionId?: string;
	title?: string;
	runId?: string;
	collapsed?: boolean;
	focusTarget?: ChatFocusTarget;
	focusTargetId?: string;
	focusTargetIds?: string[];
};

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
	role: 'user' | 'assistant';
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

export type ChatTimelineEntry =
	| {
		kind: 'message';
		role: RenderableMessage['role'];
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

export type ChatSessionViewState = {
	timeline: ChatTimelineEntry[];
	runs: ChatRun[];
	isGenerating: boolean;
	activeAssistantText: string;
	activeRunId: number;
};

export type ChatFocusTarget = {
	id: string;
	sessionId: string;
	path: string;
	startLine: number;
	endLine: number;
	title: string;
	instruction: string;
	updatedAt: number;
};
