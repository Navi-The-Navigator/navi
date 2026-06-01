import type { ChatFocusTarget } from '../../types/chat';
import type { NaviTool } from '../naviTool';
import { errorResult, parseInput, successResult } from './_shared.js';
import { getWorkspaceRoot } from './editorGateway.js';

export type JumpToFocusInput = {
	id?: string;
	index?: number;
};

type JumpToFocusResult = {
	activeIndex: number;
	activeFocusTarget: ChatFocusTarget | null;
	count: number;
};

type JumpToFocusDeps = {
	getCurrentSessionId: () => string;
	jumpToFocus: (sessionId: string, input: JumpToFocusInput) => Promise<JumpToFocusResult>;
	resolveWorkspaceRoot?: () => string | undefined;
};

export function createJumpToFocusTool(deps: JumpToFocusDeps): NaviTool {
	const resolveWorkspaceRoot = deps.resolveWorkspaceRoot ?? getWorkspaceRoot;
	return {
		name: 'jump_to_focus',
		description:
			'Reveal a previously created focus region in the editor and make it the active focus target. Use id when available, or index from get_focus_code_regions. Empty input jumps to the current active focus. Input JSON: {} or {"id":"focus-..."} or {"index":0}.',
		func: async (rawInput: string) => {
			const workspaceRoot = resolveWorkspaceRoot();
			if (!workspaceRoot) {
				return errorResult('No workspace folder is open.');
			}

			const input = parseInput<JumpToFocusInput>(rawInput, (text) => ({ id: text }));
			const sessionId = deps.getCurrentSessionId();
			const result = await deps.jumpToFocus(sessionId, input);

			return successResult({
				sessionId,
				count: result.count,
				activeIndex: result.activeIndex,
				activeFocusTarget: result.activeFocusTarget
			});
		}
	};
}
