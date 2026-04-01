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
});
