import * as vscode from 'vscode';
import type { ChatFocusTarget } from '../../types/chat';
import type { NaviTool } from '../naviTool';

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

			const input = parseInput(rawInput);
			const sessionId = deps.getCurrentSessionId();
			const result = await deps.jumpToFocus(sessionId, input);

			return JSON.stringify(
				{
					ok: true,
					sessionId,
					count: result.count,
					activeIndex: result.activeIndex,
					activeFocusTarget: result.activeFocusTarget
				},
				null,
				2
			);
		}
	};
}

function getWorkspaceRoot(): string | undefined {
	const firstFolder = vscode.workspace.workspaceFolders?.[0];
	return firstFolder?.uri.fsPath;
}

function parseInput(rawInput: string): JumpToFocusInput {
	const text = rawInput.trim();
	if (!text) {
		return {};
	}
	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text) as JumpToFocusInput;
			return parsed ?? {};
		} catch {
			return { id: text };
		}
	}
	return { id: text };
}

function errorResult(message: string): string {
	return JSON.stringify({ ok: false, error: message }, null, 2);
}