import { createThreadId, createTodoId } from '../utils/id.js';
import type {
	ChatRun,
	ChatRunEvent,
	ChatRunKind,
	ChatRunStatus,
	ChatSession,
	ChatSessionViewState,
	ChatStatusEntry,
	ChatTimelineEntry,
	ChatTodo,
	RenderableMessage
} from '../types/chat';

type ChatSessionViewStateInternal = ChatSessionViewState & {
	nextRunId: number;
	pendingAssistantError?: string;
};

const DEFAULT_EMPTY_ASSISTANT_MESSAGE = 'I have not generated any displayable text response yet.';

export class ChatSessionStore {
	private readonly sessions: ChatSession[] = [];
	private readonly todosBySessionId = new Map<string, ChatTodo[]>();
	private readonly viewStateBySessionId = new Map<string, ChatSessionViewStateInternal>();
	private currentSessionId = '';
	private nextSessionNumber = 1;

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
			title: `New Chat #${this.nextSessionNumber++}`,
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
		if (!session || !session.title.startsWith('New Chat #')) {
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
			timeline: state.timeline.map((entry) => ({ ...entry })),
			runs: state.runs.map((run) => this.cloneRun(run, { includeTransientToolStatus: false })),
			isGenerating: state.isGenerating,
			activeAssistantText: state.activeAssistantText,
			activeRunId: state.activeRunId
		};
	}

	public startRun(
		sessionId: string,
		input: { title: string; kind: ChatRunKind; parentRunId?: string; autoCollapse?: boolean }
	): ChatRun {
		const state = this.ensureViewState(sessionId);
		const now = Date.now();
		const run: ChatRun = {
			id: createThreadId().replace(/^thread-/, 'run-'),
			title: input.title.trim() || 'Sub Agent',
			kind: input.kind,
			status: 'running',
			createdAt: now,
			startedAt: now,
			parentRunId: input.parentRunId,
			collapsed: false,
			autoCollapse: input.autoCollapse ?? true,
			transientToolStatusText: '',
			activeAssistantText: '',
			finalAssistantText: '',
			events: []
		};

		state.runs.push(run);
		state.timeline.push({
			kind: 'run',
			runId: run.id,
			createdAt: now
		});
		state.activeRunId = 0;

		return this.cloneRun(run);
	}

	public getRun(sessionId: string, runId: string): ChatRun | undefined {
		const run = this.ensureViewState(sessionId).runs.find((item) => item.id === runId);
		return run ? this.cloneRun(run) : undefined;
	}

	public setRunTransientToolStatus(sessionId: string, runId: string, text: string): ChatRun | undefined {
		const run = this.findRun(sessionId, runId);
		if (!run) {
			return undefined;
		}
		run.transientToolStatusText = text.trim();
		return this.cloneRun(run);
	}

	public clearRunTransientToolStatus(sessionId: string, runId: string): ChatRun | undefined {
		const run = this.findRun(sessionId, runId);
		if (!run) {
			return undefined;
		}
		run.transientToolStatusText = '';
		return this.cloneRun(run);
	}

	public appendRunProgress(sessionId: string, runId: string, text: string): ChatRun | undefined {
		return this.appendRunEvent(sessionId, runId, {
			kind: 'progress',
			text,
			transient: false
		});
	}

	public appendRunAssistantDelta(sessionId: string, runId: string, text: string): ChatRun | undefined {
		const normalized = text;
		if (!normalized) {
			return this.getRun(sessionId, runId);
		}
		const run = this.findRun(sessionId, runId);
		if (!run) {
			return undefined;
		}
		run.activeAssistantText += normalized;
		return this.cloneRun(run);
	}

	public finishRun(
		sessionId: string,
		runId: string,
		input: { status?: Extract<ChatRunStatus, 'completed' | 'cancelled'>; elapsedText?: string; finalAssistantText?: string } = {}
	): ChatRun | undefined {
		const run = this.findRun(sessionId, runId);
		if (!run) {
			return undefined;
		}

		const finalAssistantText = (input.finalAssistantText ?? '').trim();
		if (finalAssistantText) {
			run.finalAssistantText = finalAssistantText;
		} else if (run.activeAssistantText.trim()) {
			run.finalAssistantText = run.activeAssistantText.trim();
		}

		run.status = input.status ?? 'completed';
		run.endedAt = Date.now();
		run.transientToolStatusText = '';
		if (input.elapsedText?.trim()) {
			run.elapsedText = input.elapsedText.trim();
			this.appendRunEventInternal(run, {
				kind: 'elapsed',
				text: input.elapsedText.trim(),
				transient: false
			});
		}
		if (run.autoCollapse) {
			run.collapsed = true;
		}
		return this.cloneRun(run);
	}

	public failRun(sessionId: string, runId: string, text: string, elapsedText?: string): ChatRun | undefined {
		const run = this.findRun(sessionId, runId);
		if (!run) {
			return undefined;
		}
		const normalized = text.trim();
		if (normalized) {
			this.appendRunEventInternal(run, {
				kind: 'error',
				text: normalized,
				transient: false
			});
		}
		run.status = 'error';
		run.endedAt = Date.now();
		run.transientToolStatusText = '';
		if (elapsedText?.trim()) {
			run.elapsedText = elapsedText.trim();
			this.appendRunEventInternal(run, {
				kind: 'elapsed',
				text: elapsedText.trim(),
				transient: false
			});
		}
		if (run.autoCollapse) {
			run.collapsed = true;
		}
		return this.cloneRun(run);
	}

	public setRunCollapsed(sessionId: string, runId: string, collapsed: boolean): ChatRun | undefined {
		const run = this.findRun(sessionId, runId);
		if (!run) {
			return undefined;
		}
		run.collapsed = !!collapsed;
		return this.cloneRun(run);
	}

	public appendMessage(sessionId: string, role: RenderableMessage['role'], text: string): RenderableMessage | undefined {
		const normalized = text.trim();
		if (!normalized) {
			return undefined;
		}
		const state = this.ensureViewState(sessionId);
		const message: RenderableMessage = { role, text: normalized };
		state.timeline.push({
			kind: 'message',
			role: message.role,
			text: message.text,
			createdAt: Date.now()
		});
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

	public resetAssistantReply(sessionId: string): void {
		const state = this.ensureViewState(sessionId);
		state.activeAssistantText = '';
		state.pendingAssistantError = undefined;
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
		state.timeline.push({
			kind: 'status',
			statusKind: entry.kind,
			text: entry.text,
			runId: entry.runId,
			createdAt: entry.createdAt
		});
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
		state.timeline.push({
			kind: 'message',
			role: 'assistant',
			text: finalAssistantText,
			createdAt: Date.now()
		});
		if (state.pendingAssistantError) {
			state.timeline.push({
				kind: 'message',
				role: 'assistant',
				text: state.pendingAssistantError,
				createdAt: Date.now()
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
			timeline: [],
			runs: [],
			isGenerating: false,
			activeAssistantText: '',
			activeRunId: 0,
			nextRunId: 1
		};
	}

	private appendRunEvent(
		sessionId: string,
		runId: string,
		input: Omit<ChatRunEvent, 'id' | 'createdAt'> & { text: string }
	): ChatRun | undefined {
		const run = this.findRun(sessionId, runId);
		if (!run) {
			return undefined;
		}
		this.appendRunEventInternal(run, input);
		return this.cloneRun(run);
	}

	private appendRunEventInternal(
		run: ChatRun,
		input: Omit<ChatRunEvent, 'id' | 'createdAt'> & { text: string }
	): void {
		const normalized = input.text.trim();
		if (!normalized) {
			return;
		}
		run.events.push({
			id: createTodoId().replace(/^todo-/, 'event-'),
			kind: input.kind,
			text: normalized,
			createdAt: Date.now(),
			transient: input.transient,
			status: input.status,
			toolName: input.toolName
		});
	}

	private findRun(sessionId: string, runId: string): ChatRun | undefined {
		return this.ensureViewState(sessionId).runs.find((item) => item.id === runId);
	}

	private cloneRun(run: ChatRun, options: { includeTransientToolStatus?: boolean } = {}): ChatRun {
		return {
			...run,
			transientToolStatusText: options.includeTransientToolStatus === false ? '' : run.transientToolStatusText,
			events: run.events.map((event) => ({ ...event }))
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
