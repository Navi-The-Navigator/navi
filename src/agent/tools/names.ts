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
