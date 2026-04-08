import type { ChatFocusTarget, ChatTodo } from '../types/chat';
import { createMainCustomAgents } from './agents/customAgents.js';
import { NaviChatGateway } from './chatGateway.js';
import { createClearFocusCodeRegionTool, type ClearFocusCodeRegionInput } from './tools/clearFocusCodeRegionTool.js';
import { createFocusCodeRegionTool, type FocusCodeRegionInput } from './tools/focusCodeRegionTool.js';
import { createGetFocusCodeRegionsTool, type GetFocusCodeRegionsInput } from './tools/getFocusCodeRegionsTool.js';
import { createGetErrorsTool } from './tools/getErrorsTool.js';
import { createJumpToFocusTool, type JumpToFocusInput } from './tools/jumpToFocusTool.js';
import { createManageTodosTool } from './tools/manageTodosTool.js';
import { createUpdateProgressTool } from './tools/updateProgressTool.js';

type ClearFocusCodeRegionResult = {
	removedCount: number;
	remainingCount: number;
	activeFocusTarget: ChatFocusTarget | null;
};

type GetFocusCodeRegionsResult = {
	activeIndex: number;
	targets: ChatFocusTarget[];
};

type JumpToFocusResult = {
	activeIndex: number;
	activeFocusTarget: ChatFocusTarget | null;
	count: number;
};

export type MainAgentDeps = {
	getCurrentSessionId: () => string;
	getTodos: (sessionId: string) => ChatTodo[];
	addTodo: (sessionId: string, text: string) => ChatTodo | undefined;
	deleteTodo: (sessionId: string, todoId: string) => boolean;
	updateTodoText: (sessionId: string, todoId: string, text: string) => boolean;
	setTodoCompleted: (sessionId: string, todoId: string, completed: boolean) => boolean;
	clearTodos: (sessionId: string, completedOnly?: boolean) => number;
	replaceTodos: (sessionId: string, todos: Array<{ text: string; completed?: boolean }>) => ChatTodo[];
	onTodosChanged?: (sessionId: string) => Promise<void> | void;
	focusRegion: (sessionId: string, input: FocusCodeRegionInput) => Promise<ChatFocusTarget>;
	clearFocusRegions: (sessionId: string, input: ClearFocusCodeRegionInput) => Promise<ClearFocusCodeRegionResult>;
	getFocusRegions: (sessionId: string, input: GetFocusCodeRegionsInput) => Promise<GetFocusCodeRegionsResult>;
	jumpToFocus: (sessionId: string, input: JumpToFocusInput) => Promise<JumpToFocusResult>;
	onMainProgress: (text: string) => Promise<void> | void;
};

export function createMainChatGateway(deps: MainAgentDeps): NaviChatGateway {
	return new NaviChatGateway({
		tools: [
			createGetErrorsTool(),
			createFocusCodeRegionTool({
				getCurrentSessionId: deps.getCurrentSessionId,
				focusRegion: deps.focusRegion
			}),
			createClearFocusCodeRegionTool({
				getCurrentSessionId: deps.getCurrentSessionId,
				clearFocusRegions: deps.clearFocusRegions
			}),
			createGetFocusCodeRegionsTool({
				getCurrentSessionId: deps.getCurrentSessionId,
				getFocusRegions: deps.getFocusRegions
			}),
			createJumpToFocusTool({
				getCurrentSessionId: deps.getCurrentSessionId,
				jumpToFocus: deps.jumpToFocus
			}),
			createUpdateProgressTool({
				onProgress: deps.onMainProgress
			}),
			createManageTodosTool({
				getCurrentSessionId: deps.getCurrentSessionId,
				getTodos: deps.getTodos,
				addTodo: deps.addTodo,
				deleteTodo: deps.deleteTodo,
				updateTodoText: deps.updateTodoText,
				setTodoCompleted: deps.setTodoCompleted,
				clearTodos: deps.clearTodos,
				replaceTodos: deps.replaceTodos,
				onTodosChanged: deps.onTodosChanged
			})
		],
		customAgents: createMainCustomAgents()
	});
}