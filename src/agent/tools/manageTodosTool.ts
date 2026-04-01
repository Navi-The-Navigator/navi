import { DynamicTool } from '@langchain/core/tools';
import type { ChatTodo } from '../../types/chat';

type ManageTodosAction =
	| 'list'
	| 'add'
	| 'delete'
	| 'complete'
	| 'reopen'
	| 'set_completed'
	| 'update'
	| 'clear'
	| 'replace';

type ManageTodosInput = {
	action?: ManageTodosAction;
	id?: string;
	index?: number;
	text?: string;
	completed?: boolean;
	completedOnly?: boolean;
	todos?: Array<{
		text: string;
		completed?: boolean;
	}>;
};

type ManageTodosDeps = {
	getCurrentSessionId: () => string;
	getTodos: (sessionId: string) => ChatTodo[];
	addTodo: (sessionId: string, text: string) => ChatTodo | undefined;
	deleteTodo: (sessionId: string, todoId: string) => boolean;
	updateTodoText: (sessionId: string, todoId: string, text: string) => boolean;
	setTodoCompleted: (sessionId: string, todoId: string, completed: boolean) => boolean;
	clearTodos: (sessionId: string, completedOnly?: boolean) => number;
	replaceTodos: (sessionId: string, todos: Array<{ text: string; completed?: boolean }>) => ChatTodo[];
	onTodosChanged?: (sessionId: string) => Promise<void> | void;
};

export function createManageTodosTool(deps: ManageTodosDeps): DynamicTool {
	return new DynamicTool({
		name: 'manage_todos',
		description:
			'Manage user TODO list for the current chat session. Input JSON: {action:"add|delete|complete|reopen|set_completed|update|clear|replace|list", id?, index?, text?, completed?, completedOnly?, todos?}.',
		func: async (rawInput) => {
			const input = parseInput(rawInput);
			const sessionId = deps.getCurrentSessionId();
			const action = input.action ?? inferAction(input);
			let message = '';

			if (action === 'list') {
				message = 'Listed todos.';
			} else if (action === 'add') {
				const added = deps.addTodo(sessionId, input.text ?? '');
				if (!added) {
					return errorResult('Failed to add todo: text is required.');
				}
				message = `Added todo: ${added.text}`;
			} else if (action === 'delete') {
				const targetId = resolveTodoId(input, deps.getTodos(sessionId));
				if (!targetId || !deps.deleteTodo(sessionId, targetId)) {
					return errorResult('Failed to delete todo: todo not found.');
				}
				message = `Deleted todo: ${targetId}`;
			} else if (action === 'complete' || action === 'reopen' || action === 'set_completed') {
				const targetId = resolveTodoId(input, deps.getTodos(sessionId));
				if (!targetId) {
					return errorResult('Failed to set completion: todo not found.');
				}
				const completed = action === 'complete' ? true : action === 'reopen' ? false : !!input.completed;
				if (!deps.setTodoCompleted(sessionId, targetId, completed)) {
					return errorResult('Failed to set completion: todo not found.');
				}
				message = `${completed ? 'Completed' : 'Reopened'} todo: ${targetId}`;
			} else if (action === 'update') {
				const targetId = resolveTodoId(input, deps.getTodos(sessionId));
				if (!targetId || !deps.updateTodoText(sessionId, targetId, input.text ?? '')) {
					return errorResult('Failed to update todo: check id/index and text.');
				}
				message = `Updated todo: ${targetId}`;
			} else if (action === 'clear') {
				const removed = deps.clearTodos(sessionId, input.completedOnly ?? false);
				message = `Removed ${removed} todo(s).`;
			} else if (action === 'replace') {
				const replaced = deps.replaceTodos(sessionId, input.todos ?? []);
				message = `Replaced todo list with ${replaced.length} item(s).`;
			}

			if (action !== 'list' && deps.onTodosChanged) {
				await deps.onTodosChanged(sessionId);
			}

			return JSON.stringify(
				{
					ok: true,
					action,
					message,
					sessionId,
					todos: deps.getTodos(sessionId)
				},
				null,
				2
			);
		}
	});
}

function inferAction(input: ManageTodosInput): ManageTodosAction {
	if (input.todos) {
		return 'replace';
	}
	if (input.id || Number.isFinite(input.index)) {
		if (typeof input.completed === 'boolean') {
			return 'set_completed';
		}
		if (typeof input.text === 'string' && input.text.trim()) {
			return 'update';
		}
		return 'complete';
	}
	if (typeof input.text === 'string' && input.text.trim()) {
		return 'add';
	}
	return 'list';
}

function parseInput(rawInput: string): ManageTodosInput {
	const text = rawInput.trim();
	if (!text) {
		return { action: 'list' };
	}
	if (text.startsWith('{')) {
		try {
			return JSON.parse(text) as ManageTodosInput;
		} catch {
			return { action: 'add', text };
		}
	}
	return { action: 'add', text };
}

function resolveTodoId(input: ManageTodosInput, todos: ChatTodo[]): string | undefined {
	if (input.id) {
		return input.id;
	}
	if (Number.isFinite(input.index)) {
		const index = Math.trunc(input.index as number);
		if (index >= 1 && index <= todos.length) {
			return todos[index - 1].id;
		}
	}
	return undefined;
}

function errorResult(message: string): string {
	return JSON.stringify({ ok: false, error: message }, null, 2);
}
