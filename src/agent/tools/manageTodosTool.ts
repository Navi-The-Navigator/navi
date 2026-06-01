import type { ChatTodo } from '../../types/chat';
import type { NaviTool } from '../naviTool';
import { errorResult, successResult } from './_shared.js';

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
	parseError?: string;
	todos?: Array<{
		text: string;
		completed?: boolean;
	}>;
};

const MANAGE_TODOS_ACTIONS: readonly ManageTodosAction[] = [
	'list',
	'add',
	'delete',
	'complete',
	'reopen',
	'set_completed',
	'update',
	'clear',
	'replace'
];

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

export function createManageTodosTool(deps: ManageTodosDeps): NaviTool {
	return {
		name: 'manage_todos',
		description:
			'Manage the visible TODO checklist for the current chat session. Always call this tool with an action command, not by writing the command text into a todo item. Prefer JSON input like {"action":"list"} or {"action":"replace","todos":[{"text":"Support log statement parsing","completed":false}]}. Supported actions: add, delete, complete, reopen, set_completed, update, clear, replace, list. Todo text should be a short user-facing title only; never pass raw tool-call text like "list" or "replace [...]" as a todo item.',
		func: async (rawInput: string) => {
			const input = parseInput(rawInput);
			if (input.parseError) {
				return errorResult(input.parseError);
			}
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

			return successResult({
				action,
				message,
				sessionId,
				todos: deps.getTodos(sessionId)
			});
		}
	};
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

	const commandInput = parseCommandInput(text);
	if (commandInput) {
		return commandInput;
	}

	return { action: 'add', text };
}

function parseCommandInput(text: string): ManageTodosInput | undefined {
	const match = /^(\w+)(?:\s+([\s\S]+))?$/u.exec(text);
	if (!match) {
		return undefined;
	}

	const actionText = match[1].toLowerCase();
	if (!isManageTodosAction(actionText)) {
		return undefined;
	}

	const action = actionText;
	const rest = (match[2] ?? '').trim();
	if (!rest) {
		return { action };
	}

	if (rest.startsWith('{')) {
		try {
			return { action, ...(JSON.parse(rest) as ManageTodosInput) };
		} catch {
			return { action, parseError: `Failed to parse ${action} payload: expected valid JSON object.` };
		}
	}

	if (rest.startsWith('[')) {
		if (action !== 'replace') {
			return { action, parseError: `${action} does not accept a JSON array payload.` };
		}
		try {
			const todos = JSON.parse(rest) as ManageTodosInput['todos'];
			if (!Array.isArray(todos)) {
				return { action, parseError: 'Failed to parse replace payload: expected a JSON array.' };
			}
			return { action, todos };
		} catch {
			return { action, parseError: 'Failed to parse replace payload: expected valid JSON array.' };
		}
	}

	if (/^\d+$/u.test(rest)) {
		const index = Number.parseInt(rest, 10);
		if (action === 'delete' || action === 'complete' || action === 'reopen') {
			return { action, index };
		}
	}

	if (action === 'add' || action === 'update') {
		return { action, text: rest };
	}

	if (action === 'delete' || action === 'complete' || action === 'reopen') {
		return { action, id: rest };
	}

	return {
		action,
		parseError: `Unsupported ${action} command format. Use JSON input for this action.`
	};
}

function isManageTodosAction(value: string): value is ManageTodosAction {
	return (MANAGE_TODOS_ACTIONS as readonly string[]).includes(value);
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
