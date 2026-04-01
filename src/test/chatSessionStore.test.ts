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
});