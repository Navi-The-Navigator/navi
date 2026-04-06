import type { ChatFocusTarget, ChatTodo } from '../types/chat';
import { createMainCustomAgents } from './agents/customAgents';
import { NaviChatGateway } from './chatGateway';
import { createClearFocusCodeRegionTool, type ClearFocusCodeRegionInput } from './tools/clearFocusCodeRegionTool';
import { createDateTimeTool } from './tools/dateTimeTool';
import { createFocusCodeRegionTool, type FocusCodeRegionInput } from './tools/focusCodeRegionTool';
import { createGetFocusCodeRegionsTool, type GetFocusCodeRegionsInput } from './tools/getFocusCodeRegionsTool';
import { createGetWorkspaceErrorsTool } from './tools/getWorkspaceErrorsTool';
import { createManageTodosTool } from './tools/manageTodosTool';
import { createProjectStructureTool } from './tools/projectStructureTool';
import { createReadFileTool } from './tools/readFileTool';
import { createSearchFileContentTool } from './tools/searchFileContentTool';
import { createSearchFilesTool } from './tools/searchFilesTool';
import { createUpdateProgressTool } from './tools/updateProgressTool';

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