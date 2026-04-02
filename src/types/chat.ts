export type ChatInboundMessage = {
	type?: string;
	text?: string;
	sessionId?: string;
	title?: string;
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

export type ChatFocusTarget = {
	id: string;
	sessionId: string;
	path: string;
	startLine: number;
	endLine: number;
	title: string;
	instruction: string;
	resolvedBy: 'anchor' | 'lines';
	anchorText?: string;
	updatedAt: number;
};
