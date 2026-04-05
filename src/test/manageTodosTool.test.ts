import * as assert from 'assert';
import { createManageTodosTool } from '../agent/tools/manageTodosTool';
import { ChatSessionStore } from '../chat/sessionStore';

suite('createManageTodosTool', () => {
	test('adds and completes todos via tool actions', async () => {
		const store = new ChatSessionStore();
		const sessionId = store.getCurrentSessionId();
		let onChangedCount = 0;
		const tool = createManageTodosTool({
			getCurrentSessionId: () => sessionId,
			getTodos: (id) => store.getTodos(id),
			addTodo: (id, text) => store.addTodo(id, text),
			deleteTodo: (id, todoId) => store.deleteTodo(id, todoId),
			updateTodoText: (id, todoId, text) => store.updateTodoText(id, todoId, text),
			setTodoCompleted: (id, todoId, completed) => store.setTodoCompleted(id, todoId, completed),
			clearTodos: (id, completedOnly) => store.clearTodos(id, completedOnly),
			replaceTodos: (id, todos) => store.replaceTodos(id, todos),
			onTodosChanged: () => {
				onChangedCount += 1;
			}
		});

		const added = JSON.parse(await tool.func('{"action":"add","text":"prepare migration plan"}')) as {
			ok: boolean;
			todos: Array<{ id: string; completed: boolean }>;
		};
		assert.strictEqual(added.ok, true);
		assert.strictEqual(added.todos.length, 1);
		assert.strictEqual(onChangedCount, 1);

		const todoId = added.todos[0].id;
		const completed = JSON.parse(await tool.func(`{"action":"complete","id":"${todoId}"}`)) as {
			ok: boolean;
			todos: Array<{ id: string; completed: boolean }>;
		};
		assert.strictEqual(completed.ok, true);
		assert.strictEqual(completed.todos[0].completed, true);
		assert.strictEqual(onChangedCount, 2);
	});

	test('supports index-based delete and list operations', async () => {
		const store = new ChatSessionStore();
		const sessionId = store.getCurrentSessionId();
		store.addTodo(sessionId, 'first');
		store.addTodo(sessionId, 'second');

		const tool = createManageTodosTool({
			getCurrentSessionId: () => sessionId,
			getTodos: (id) => store.getTodos(id),
			addTodo: (id, text) => store.addTodo(id, text),
			deleteTodo: (id, todoId) => store.deleteTodo(id, todoId),
			updateTodoText: (id, todoId, text) => store.updateTodoText(id, todoId, text),
			setTodoCompleted: (id, todoId, completed) => store.setTodoCompleted(id, todoId, completed),
			clearTodos: (id, completedOnly) => store.clearTodos(id, completedOnly),
			replaceTodos: (id, todos) => store.replaceTodos(id, todos)
		});

		const deleted = JSON.parse(await tool.func('{"action":"delete","index":1}')) as {
			ok: boolean;
			todos: Array<{ text: string }>;
		};
		assert.strictEqual(deleted.ok, true);
		assert.strictEqual(deleted.todos.length, 1);
		assert.strictEqual(deleted.todos[0].text, 'second');

		const listed = JSON.parse(await tool.func('{"action":"list"}')) as {
			ok: boolean;
			todos: Array<{ text: string }>;
		};
		assert.strictEqual(listed.ok, true);
		assert.strictEqual(listed.todos.length, 1);
	});
});
