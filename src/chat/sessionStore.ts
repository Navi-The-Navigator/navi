import { createThreadId, createTodoId } from '../utils/id';
import type { ChatSession, ChatSessionViewState, ChatStatusEntry, ChatTodo, RenderableMessage } from '../types/chat';

type ChatSessionViewStateInternal = ChatSessionViewState & {
	nextRunId: number;
	pendingAssistantError?: string;
};

const DEFAULT_EMPTY_ASSISTANT_MESSAGE = '我暂时没有生成可显示的文本响应。';

export class ChatSessionStore {
	private readonly sessions: ChatSession[] = [];
	private readonly todosBySessionId = new Map<string, ChatTodo[]>();
	private readonly viewStateBySessionId = new Map<string, ChatSessionViewStateInternal>();
	private currentSessionId = '';

	constructor() {
		const firstSession = this.createSession();
		this.currentSessionId = firstSession.id;
	}

	public getSessions(): ChatSession[] {
		return this.sessions;
	}

	public getCurrentSessionId(): string {
		return this.currentSessionId;
	}

	public createSession(): ChatSession {
		const session: ChatSession = {
			id: createThreadId(),
			title: 'New Chat',
			createdAt: Date.now()
		};

		this.sessions.unshift(session);
		this.todosBySessionId.set(session.id, []);
		this.viewStateBySessionId.set(session.id, this.createViewState());
		this.currentSessionId = session.id;
		return session;
	}

	public switchSession(sessionId: string): boolean {
		if (!this.sessions.some((session) => session.id === sessionId)) {
			return false;
		}

		this.currentSessionId = sessionId;
		return true;
	}

	public updateSessionTitleIfNeeded(sessionId: string, prompt: string): void {
		const session = this.sessions.find((item) => item.id === sessionId);
		if (!session || session.title !== 'New Chat') {
			return;
		}

		const normalized = prompt.replace(/\s+/g, ' ').trim();
		session.title = normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
	}

	public renameSession(sessionId: string, nextTitle: string): boolean {
		const session = this.sessions.find((item) => item.id === sessionId);
		if (!session) {
			return false;
		}

		const normalized = nextTitle.replace(/\s+/g, ' ').trim();
		session.title = normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
		return true;
	}

	public deleteSession(sessionId: string): boolean {
		const index = this.sessions.findIndex((item) => item.id === sessionId);
		if (index < 0) {
			return false;
		}

		const deletingCurrent = this.currentSessionId === sessionId;
		this.sessions.splice(index, 1);
		this.todosBySessionId.delete(sessionId);
		this.viewStateBySessionId.delete(sessionId);

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

	public getTodos(sessionId: string): ChatTodo[] {
		return [...(this.todosBySessionId.get(sessionId) ?? [])];
	}

	public getViewState(sessionId: string): ChatSessionViewState {
		const state = this.ensureViewState(sessionId);
		return {
			messages: state.messages.map((message) => ({ ...message })),
			statusEntries: state.statusEntries.map((entry) => ({ ...entry })),
			isGenerating: state.isGenerating,
			activeAssistantText: state.activeAssistantText,
			activeRunId: state.activeRunId
		};
	}

	public appendMessage(sessionId: string, role: RenderableMessage['role'], text: string): RenderableMessage | undefined {
		const normalized = text.trim();
		if (!normalized) {
			return undefined;
		}
		const state = this.ensureViewState(sessionId);
		const message: RenderableMessage = { role, text: normalized };
		state.messages.push(message);
		return { ...message };
	}

	public startAssistantReply(sessionId: string): number {
		const state = this.ensureViewState(sessionId);
		state.isGenerating = true;
		state.activeAssistantText = '';
		state.pendingAssistantError = undefined;
		state.activeRunId = state.nextRunId;
		state.nextRunId += 1;
		return state.activeRunId;
	}

	public appendAssistantDelta(sessionId: string, text: string): string {
		if (!text) {
			return this.ensureViewState(sessionId).activeAssistantText;
		}
		const state = this.ensureViewState(sessionId);
		state.activeAssistantText += text;
		return state.activeAssistantText;
	}

	public appendStatusEntry(sessionId: string, kind: ChatStatusEntry['kind'], text: string): ChatStatusEntry | undefined {
		const normalized = text.trim();
		if (!normalized) {
			return undefined;
		}
		const state = this.ensureViewState(sessionId);
		if (!state.activeRunId) {
			state.activeRunId = state.nextRunId;
			state.nextRunId += 1;
		}
		const entry: ChatStatusEntry = {
			kind,
			text: normalized,
			runId: state.activeRunId,
			createdAt: Date.now()
		};
		state.statusEntries.push(entry);
		return { ...entry };
	}

	public setAssistantError(sessionId: string, text: string): void {
		const normalized = text.trim();
		if (!normalized) {
			return;
		}
		const state = this.ensureViewState(sessionId);
		if (state.activeAssistantText.trim()) {
			state.pendingAssistantError = normalized;
			return;
		}
		state.activeAssistantText = normalized;
	}

	public finishAssistantReply(sessionId: string): void {
		const state = this.ensureViewState(sessionId);
		const finalAssistantText = state.activeAssistantText.trim() || DEFAULT_EMPTY_ASSISTANT_MESSAGE;
		state.messages.push({
			role: 'assistant',
			text: finalAssistantText
		});
		if (state.pendingAssistantError) {
			state.messages.push({
				role: 'assistant',
				text: state.pendingAssistantError
			});
		}
		state.isGenerating = false;
		state.activeAssistantText = '';
		state.activeRunId = 0;
		state.pendingAssistantError = undefined;
	}

	public addTodo(sessionId: string, text: string): ChatTodo | undefined {
		const normalized = text.replace(/\s+/g, ' ').trim();
		if (!normalized) {
			return undefined;
		}
		const todos = this.ensureTodoList(sessionId);
		const todo: ChatTodo = {
			id: createTodoId(),
			text: normalized.length > 200 ? `${normalized.slice(0, 200)}...` : normalized,
			completed: false,
			createdAt: Date.now()
		};
		todos.push(todo);
		return todo;
	}

	public deleteTodo(sessionId: string, todoId: string): boolean {
		const todos = this.ensureTodoList(sessionId);
		const index = todos.findIndex((todo) => todo.id === todoId);
		if (index < 0) {
			return false;
		}
		todos.splice(index, 1);
		return true;
	}

	public updateTodoText(sessionId: string, todoId: string, text: string): boolean {
		const todos = this.ensureTodoList(sessionId);
		const todo = todos.find((item) => item.id === todoId);
		if (!todo) {
			return false;
		}
		const normalized = text.replace(/\s+/g, ' ').trim();
		if (!normalized) {
			return false;
		}
		todo.text = normalized.length > 200 ? `${normalized.slice(0, 200)}...` : normalized;
		return true;
	}

	public setTodoCompleted(sessionId: string, todoId: string, completed: boolean): boolean {
		const todos = this.ensureTodoList(sessionId);
		const todo = todos.find((item) => item.id === todoId);
		if (!todo) {
			return false;
		}
		todo.completed = completed;
		todo.completedAt = completed ? Date.now() : undefined;
		return true;
	}

	public clearTodos(sessionId: string, completedOnly = false): number {
		const todos = this.ensureTodoList(sessionId);
		if (!completedOnly) {
			const removedCount = todos.length;
			todos.splice(0, todos.length);
			return removedCount;
		}
		const previousCount = todos.length;
		const pending = todos.filter((todo) => !todo.completed);
		todos.splice(0, todos.length, ...pending);
		return previousCount - pending.length;
	}

	public replaceTodos(sessionId: string, entries: Array<{ text: string; completed?: boolean }>): ChatTodo[] {
		const todos = this.ensureTodoList(sessionId);
		todos.splice(0, todos.length);
		for (const entry of entries) {
			const normalized = entry.text.replace(/\s+/g, ' ').trim();
			if (!normalized) {
				continue;
			}
			const completed = entry.completed ?? false;
			todos.push({
				id: createTodoId(),
				text: normalized.length > 200 ? `${normalized.slice(0, 200)}...` : normalized,
				completed,
				createdAt: Date.now(),
				completedAt: completed ? Date.now() : undefined
			});
		}
		return this.getTodos(sessionId);
	}

	private ensureTodoList(sessionId: string): ChatTodo[] {
		let todos = this.todosBySessionId.get(sessionId);
		if (!todos) {
			todos = [];
			this.todosBySessionId.set(sessionId, todos);
		}
		return todos;
	}

	private createViewState(): ChatSessionViewStateInternal {
		return {
			messages: [],
			statusEntries: [],
			isGenerating: false,
			activeAssistantText: '',
			activeRunId: 0,
			nextRunId: 1
		};
	}

	private ensureViewState(sessionId: string): ChatSessionViewStateInternal {
		let state = this.viewStateBySessionId.get(sessionId);
		if (!state) {
			state = this.createViewState();
			this.viewStateBySessionId.set(sessionId, state);
		}
		return state;
	}
}
