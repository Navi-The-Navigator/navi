/**
 * Canonical built-in tool names — the single source of truth. Sub-agent
 * definitions and any code that references a tool by name import from here
 * instead of hard-coding string literals.
 */
export const TOOL_NAMES = {
	getErrors: 'get_errors',
	focusUserCodeRegion: 'focus_user_code_region',
	clearFocusCodeRegion: 'clear_focus_code_region',
	getFocusCodeRegions: 'get_focus_code_regions',
	jumpToFocus: 'jump_to_focus',
	updateProgress: 'update_progress',
	manageTodos: 'manage_todos'
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/**
 * Investigation tools provided by the Copilot CLI itself (not Navi tools).
 * Granted to the planning and exploration sub-agents so they can actually read
 * and search code. Names match the CLI's built-in `explore` agent definition.
 */
export const BUILTIN_TOOL_NAMES = {
	view: 'view',
	grep: 'grep',
	glob: 'glob',
	lsp: 'lsp',
	bash: 'bash'
} as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[keyof typeof BUILTIN_TOOL_NAMES];
