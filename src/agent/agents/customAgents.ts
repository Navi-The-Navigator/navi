import type { CustomAgentConfig } from '@github/copilot-sdk';
import { CODE_REVIEW_AGENT_SYSTEM_PROMPT } from './config';

export const CODE_REVIEW_AGENT_NAME = 'code_review_agent';
export const CODE_REVIEW_AGENT_DISPLAY_NAME = 'Task Assessment Agent';

const CODE_REVIEW_AGENT_TOOLS = [
	'read_project_structure',
	'read_file',
	'search_files',
	'search_file_content',
	'get_workspace_errors',
	'update_progress'
];

export function createMainCustomAgents(): CustomAgentConfig[] {
	return [
		{
			name: CODE_REVIEW_AGENT_NAME,
			displayName: CODE_REVIEW_AGENT_DISPLAY_NAME,
			description: 'Evaluates whether a coding task is truly complete based on workspace evidence, tests, integrations, and focused code regions.',
			tools: CODE_REVIEW_AGENT_TOOLS,
			prompt: CODE_REVIEW_AGENT_SYSTEM_PROMPT,
			infer: false
		}
	];
}