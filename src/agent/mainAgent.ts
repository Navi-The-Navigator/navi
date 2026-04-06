import type { ChatFocusTarget, ChatTodo } from '../types/chat';
import { createMainCustomAgents } from './agents/customAgents.js';
import { NaviChatGateway } from './chatGateway.js';
import { createClearFocusCodeRegionTool, type ClearFocusCodeRegionInput } from './tools/clearFocusCodeRegionTool.js';
import { createDateTimeTool } from './tools/dateTimeTool.js';
import { createFocusCodeRegionTool, type FocusCodeRegionInput } from './tools/focusCodeRegionTool.js';
import { createGetFocusCodeRegionsTool, type GetFocusCodeRegionsInput } from './tools/getFocusCodeRegionsTool.js';
import { createGetWorkspaceErrorsTool } from './tools/getWorkspaceErrorsTool.js';
import { createManageTodosTool } from './tools/manageTodosTool.js';
import { createProjectStructureTool } from './tools/projectStructureTool.js';
import { createReadFileTool } from './tools/readFileTool.js';
import { createSearchFileContentTool } from './tools/searchFileContentTool.js';
import { createSearchFilesTool } from './tools/searchFilesTool.js';
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
	onMainProgress: (text: string) => Promise<void> | void;
};

export function createMainChatGateway(deps: MainAgentDeps): NaviChatGateway {
	return new NaviChatGateway({
		tools: [
			createDateTimeTool(),
			createProjectStructureTool(),
			createReadFileTool(),
			createSearchFilesTool(),
			createSearchFileContentTool(),
			createGetWorkspaceErrorsTool(),
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