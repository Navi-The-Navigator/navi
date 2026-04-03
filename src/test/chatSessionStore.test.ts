import * as assert from 'assert';
import { ChatSessionStore } from '../chat/sessionStore';

suite('ChatSessionStore', () => {
	test('initializes with one current session', () => {
		const store = new ChatSessionStore();
		const sessions = store.getSessions();

		assert.strictEqual(sessions.length, 1);
		assert.strictEqual(sessions[0].title, 'New Chat');
		assert.strictEqual(store.getCurrentSessionId(), sessions[0].id);
	});

	test('creates a new session at the front and makes it current', () => {
		const store = new ChatSessionStore();
		const initialSessionId = store.getCurrentSessionId();
		const created = store.createSession();

		assert.strictEqual(store.getCurrentSessionId(), created.id);
		assert.strictEqual(store.getSessions()[0].id, created.id);
		assert.notStrictEqual(created.id, initialSessionId);
	});

	test('switches sessions only when the target exists', () => {
		const store = new ChatSessionStore();
		const created = store.createSession();

		assert.strictEqual(store.switchSession('missing-session'), false);
		assert.strictEqual(store.getCurrentSessionId(), created.id);

		const original = store.getSessions()[1];
		assert.strictEqual(store.switchSession(original.id), true);
		assert.strictEqual(store.getCurrentSessionId(), original.id);
	});

	test('updates a default title from the first prompt with normalization and truncation', () => {
		const store = new ChatSessionStore();
		const sessionId = store.getCurrentSessionId();

		store.updateSessionTitleIfNeeded(sessionId, '   build   a    regression suite for   the sidebar provider   ');

		assert.strictEqual(store.getSessions()[0].title, 'build a regression suite...');
	});

	test('does not overwrite a custom title when subsequent prompts arrive', () => {
		const store = new ChatSessionStore();
		const sessionId = store.getCurrentSessionId();

		store.renameSession(sessionId, 'Pinned session');
		store.updateSessionTitleIfNeeded(sessionId, 'this should not replace the custom title');

		assert.strictEqual(store.getSessions()[0].title, 'Pinned session');
	});

	test('renames a session with normalization and 36-character truncation', () => {
		const store = new ChatSessionStore();
		const sessionId = store.getCurrentSessionId();

		assert.strictEqual(
			store.renameSession(sessionId, '   This     renamed session title should be clipped for display in the menu   '),
			true
		);
		assert.strictEqual(store.getSessions()[0].title, 'This renamed session title should be...');
	});

	test('deletes missing sessions without changing state', () => {
		const store = new ChatSessionStore();
		const currentSessionId = store.getCurrentSessionId();

		assert.strictEqual(store.deleteSession('missing-session'), false);
		assert.strictEqual(store.getCurrentSessionId(), currentSessionId);
		assert.strictEqual(store.getSessions().length, 1);
	});

	test('recreates a session when deleting the last remaining one', () => {
		const store = new ChatSessionStore();
		const previousSessionId = store.getCurrentSessionId();

		assert.strictEqual(store.deleteSession(previousSessionId), true);
		assert.strictEqual(store.getSessions().length, 1);
		assert.notStrictEqual(store.getCurrentSessionId(), previousSessionId);
		assert.strictEqual(store.getCurrentSessionId(), store.getSessions()[0].id);
	});

	test('manages todos within a session', () => {
		const store = new ChatSessionStore();
		const sessionId = store.getCurrentSessionId();
		const first = store.addTodo(sessionId, '  add task breakdown ');
		const second = store.addTodo(sessionId, 'write tests');

		assert.ok(first);
		assert.ok(second);
		assert.strictEqual(store.getTodos(sessionId).length, 2);
		assert.strictEqual(store.setTodoCompleted(sessionId, first!.id, true), true);
		assert.strictEqual(store.updateTodoText(sessionId, second!.id, 'write integration tests'), true);
		assert.strictEqual(store.getTodos(sessionId).filter((todo) => todo.completed).length, 1);
		assert.strictEqual(store.clearTodos(sessionId, true), 1);
		assert.strictEqual(store.getTodos(sessionId).length, 1);
		assert.strictEqual(store.deleteTodo(sessionId, second!.id), true);
		assert.strictEqual(store.getTodos(sessionId).length, 0);
	});

	test('cleans up todos when deleting a session', () => {
		const store = new ChatSessionStore();
		const firstSession = store.getCurrentSessionId();
		store.addTodo(firstSession, 'todo-a');

		const secondSession = store.createSession().id;
		store.addTodo(secondSession, 'todo-b');
		assert.strictEqual(store.getTodos(secondSession).length, 1);

		assert.strictEqual(store.deleteSession(secondSession), true);
		assert.deepStrictEqual(store.getTodos(secondSession), []);
		assert.strictEqual(store.getTodos(firstSession).length, 1);
	});

	test('stores replayable view state for messages and progress entries', () => {
		const store = new ChatSessionStore();
		const sessionId = store.getCurrentSessionId();

		store.appendMessage(sessionId, 'user', 'first question');
		const runId = store.startAssistantReply(sessionId);
		store.appendStatusEntry(sessionId, 'progress', '扫描项目结构');
		store.appendAssistantDelta(sessionId, '正在分析');
		store.appendStatusEntry(sessionId, 'elapsed', '用时：1.25s');
		store.finishAssistantReply(sessionId);

		const state = store.getViewState(sessionId);
		assert.strictEqual(runId, 1);
		assert.strictEqual(state.isGenerating, false);
		assert.strictEqual(state.activeAssistantText, '');
		assert.strictEqual(state.activeRunId, 0);
		assert.deepStrictEqual(state.timeline.map((entry) => entry.kind), ['message', 'status', 'status', 'message']);
		assert.deepStrictEqual(state.timeline[0], {
			kind: 'message',
			role: 'user',
			text: 'first question',
			createdAt: state.timeline[0].createdAt
		});
		assert.deepStrictEqual(state.timeline[1], {
			kind: 'status',
			statusKind: 'progress',
			text: '扫描项目结构',
			runId: 1,
			createdAt: state.timeline[1].createdAt
		});
		assert.deepStrictEqual(state.timeline[2], {
			kind: 'status',
			statusKind: 'elapsed',
			text: '用时：1.25s',
			runId: 1,
			createdAt: state.timeline[2].createdAt
		});
		assert.deepStrictEqual(state.timeline[3], {
			kind: 'message',
			role: 'assistant',
			text: '正在分析',
			createdAt: state.timeline[3].createdAt
		});
	});

	test('keeps in-flight assistant content available for webview restore', () => {
		const store = new ChatSessionStore();
		const sessionId = store.getCurrentSessionId();

		store.appendMessage(sessionId, 'user', 'follow up');
		store.startAssistantReply(sessionId);
		store.appendAssistantDelta(sessionId, 'partial answer');
		store.appendStatusEntry(sessionId, 'progress', '正在读取文件');

		const state = store.getViewState(sessionId);
		assert.strictEqual(state.isGenerating, true);
		assert.strictEqual(state.activeAssistantText, 'partial answer');
		assert.strictEqual(state.timeline.length, 2);
		assert.strictEqual(state.timeline[0].kind, 'message');
		assert.strictEqual(state.timeline[1].kind, 'status');
	});

	test('stores subagent run timeline and final state for replay', () => {
		const store = new ChatSessionStore();
		const sessionId = store.getCurrentSessionId();

		store.appendMessage(sessionId, 'user', 'review this module');
		const run = store.startRun(sessionId, {
			title: 'Task Assessment Agent',
			kind: 'code_review'
		});
		store.setRunTransientToolStatus(sessionId, run.id, '正在调用工具 `read_file`...');
		store.appendRunProgress(sessionId, run.id, '正在分析模块边界');
		store.appendRunAssistantDelta(sessionId, run.id, '发现一处缺少空值判断');
		store.clearRunTransientToolStatus(sessionId, run.id);
		store.finishRun(sessionId, run.id, {
			elapsedText: '用时：0.42s',
			finalAssistantText: '发现一处缺少空值判断'
		});

		const state = store.getViewState(sessionId);
		assert.strictEqual(state.runs.length, 1);
		assert.deepStrictEqual(state.timeline.map((entry) => entry.kind), ['message', 'run']);
		assert.strictEqual(state.runs[0].id, run.id);
		assert.strictEqual(state.runs[0].status, 'completed');
		assert.strictEqual(state.runs[0].collapsed, true);
		assert.strictEqual(state.runs[0].elapsedText, '用时：0.42s');
		assert.strictEqual(state.runs[0].transientToolStatusText, '');
		assert.strictEqual(state.runs[0].finalAssistantText, '发现一处缺少空值判断');
		assert.strictEqual(state.runs[0].events.length, 2);
		assert.deepStrictEqual(state.runs[0].events.map((event) => event.kind), ['progress', 'elapsed']);
	});

	test('splits top-level progress groups when a subagent run starts', () => {
		const store = new ChatSessionStore();
		const sessionId = store.getCurrentSessionId();

		store.appendMessage(sessionId, 'user', 'review and continue');
		store.startAssistantReply(sessionId);
		store.appendStatusEntry(sessionId, 'progress', '先读取项目结构');
		const run = store.startRun(sessionId, {
			title: 'Task Assessment Agent',
			kind: 'code_review'
		});
		store.appendStatusEntry(sessionId, 'progress', '根据子任务结果整理结论');

		const state = store.getViewState(sessionId);
		const statusEntries = state.timeline.filter((entry) => entry.kind === 'status');

		assert.strictEqual(state.runs[0].id, run.id);
		assert.strictEqual(statusEntries.length, 2);
		assert.strictEqual(statusEntries[0].runId, 1);
		assert.strictEqual(statusEntries[1].runId, 2);
		assert.deepStrictEqual(state.timeline.map((entry) => entry.kind), ['message', 'status', 'run', 'status']);
	});

	test('does not replay transient subagent tool state through session view state', () => {
		const store = new ChatSessionStore();
		const sessionId = store.getCurrentSessionId();
		const run = store.startRun(sessionId, {
			title: 'Task Assessment Agent',
			kind: 'code_review'
		});

		store.setRunTransientToolStatus(sessionId, run.id, '正在调用工具 `read_file`...');

		const liveRun = store.getRun(sessionId, run.id);
		const viewState = store.getViewState(sessionId);

		assert.strictEqual(liveRun?.transientToolStatusText, '正在调用工具 `read_file`...');
		assert.strictEqual(viewState.runs[0].transientToolStatusText, '');
	});
});
