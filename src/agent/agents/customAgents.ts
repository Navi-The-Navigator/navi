import type { CustomAgentConfig } from '@github/copilot-sdk';
import { CODE_EXPLORER_AGENT_SYSTEM_PROMPT, PLANNING_AGENT_SYSTEM_PROMPT } from '../../prompts/index.js';
import { BUILTIN_TOOL_NAMES, TOOL_NAMES } from '../tools/names.js';

export const CODE_EXPLORER_AGENT_NAME = 'code_explorer';
export const CODE_EXPLORER_AGENT_DISPLAY_NAME = 'Explore Agent';

const CODE_EXPLORER_AGENT_TOOLS = [
	BUILTIN_TOOL_NAMES.grep,
	BUILTIN_TOOL_NAMES.glob,
	BUILTIN_TOOL_NAMES.view,
	BUILTIN_TOOL_NAMES.lsp,
	BUILTIN_TOOL_NAMES.bash,
	TOOL_NAMES.updateProgress
];

export const PLANNING_AGENT_NAME = 'planning_agent';
export const PLANNING_AGENT_DISPLAY_NAME = 'Planning Agent';

const PLANNING_AGENT_TOOLS = [
	TOOL_NAMES.manageTodos,
	TOOL_NAMES.updateProgress,
	BUILTIN_TOOL_NAMES.view,
	BUILTIN_TOOL_NAMES.grep,
	BUILTIN_TOOL_NAMES.glob,
	BUILTIN_TOOL_NAMES.lsp
];

/**
 * Built-in Copilot CLI agents the main agent delegates to (reachable through the
 * Task tool's `agent_type`). They are not registered by Navi — these constants
 * just name them so the run tracker and prompts can key on them consistently.
 * Exploration is handled by Navi's own `code_explorer` (so it can report
 * progress); review is delegated to these built-ins.
 */
export const BUILTIN_AGENTS = {
	critic: 'critic',
	codeReview: 'code-review'
} as const;

export type BuiltinAgentName = (typeof BUILTIN_AGENTS)[keyof typeof BUILTIN_AGENTS];

export function createMainCustomAgents(): CustomAgentConfig[] {
	return [
		{
			name: CODE_EXPLORER_AGENT_NAME,
			displayName: CODE_EXPLORER_AGENT_DISPLAY_NAME,
			description: 'Investigates the codebase (read-only) and reports the minimal context the main agent needs, with milestone progress.',
			tools: CODE_EXPLORER_AGENT_TOOLS,
			prompt: CODE_EXPLORER_AGENT_SYSTEM_PROMPT,
			infer: false
		},
		{
			name: PLANNING_AGENT_NAME,
			displayName: PLANNING_AGENT_DISPLAY_NAME,
			description: 'Maps the change points for a requested change and writes the resulting todos into Navi.',
			tools: PLANNING_AGENT_TOOLS,
			prompt: PLANNING_AGENT_SYSTEM_PROMPT,
			infer: false
		}
	];
}
