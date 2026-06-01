import type { CustomAgentConfig } from '@github/copilot-sdk';
import {
	CODE_EXPLORATION_AGENT_SYSTEM_PROMPT,
	CODE_REVIEW_AGENT_SYSTEM_PROMPT,
	PLANNING_AGENT_SYSTEM_PROMPT
} from '../../prompts/index.js';
import { TOOL_NAMES } from '../tools/names.js';

export const CODE_REVIEW_AGENT_NAME = 'code_review_agent';
export const CODE_REVIEW_AGENT_DISPLAY_NAME = 'Task Assessment Agent';

const CODE_REVIEW_AGENT_TOOLS = [
	TOOL_NAMES.getErrors,
	TOOL_NAMES.updateProgress,
	TOOL_NAMES.manageTodos,
	TOOL_NAMES.clearFocusCodeRegion
];

export const PLANNING_AGENT_NAME = 'planning_agent';
export const PLANNING_AGENT_DISPLAY_NAME = 'Planning Agent';

const PLANNING_AGENT_TOOLS = [
	TOOL_NAMES.updateProgress,
	TOOL_NAMES.manageTodos
];

export const CODE_EXPLORATION_AGENT_NAME = 'code_exploration_agent';
export const CODE_EXPLORATION_AGENT_DISPLAY_NAME = 'Code Exploration Agent';

const CODE_EXPLORATION_AGENT_TOOLS = [
	TOOL_NAMES.getErrors,
	TOOL_NAMES.updateProgress
];

export function createMainCustomAgents(): CustomAgentConfig[] {
	return [
		{
			name: CODE_EXPLORATION_AGENT_NAME,
			displayName: CODE_EXPLORATION_AGENT_DISPLAY_NAME,
			description: 'Explores the codebase, locates relevant implementations, and summarizes evidence for the main agent before planning or explanation.',
			tools: CODE_EXPLORATION_AGENT_TOOLS,
			prompt: CODE_EXPLORATION_AGENT_SYSTEM_PROMPT,
			infer: false
		},
		{
			name: CODE_REVIEW_AGENT_NAME,
			displayName: CODE_REVIEW_AGENT_DISPLAY_NAME,
			description: 'Evaluates whether a coding task is truly complete based on workspace evidence, tests, integrations, and focused code regions.',
			tools: CODE_REVIEW_AGENT_TOOLS,
			prompt: CODE_REVIEW_AGENT_SYSTEM_PROMPT,
			infer: false
		},
		{
			name: PLANNING_AGENT_NAME,
			displayName: PLANNING_AGENT_DISPLAY_NAME,
			description: 'Generates todos based on user requirements, project structure, and code context.',
			tools: PLANNING_AGENT_TOOLS,
			prompt: PLANNING_AGENT_SYSTEM_PROMPT,
			infer: false
		}
	];
}