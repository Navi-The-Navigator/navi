export type ChatInboundMessage = {
	type?: string;
	text?: string;
	sessionId?: string;
	title?: string;
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
