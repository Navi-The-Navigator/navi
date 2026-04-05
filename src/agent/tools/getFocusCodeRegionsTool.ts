import * as path from 'path';
import * as vscode from 'vscode';
import type { ChatFocusTarget } from '../../types/chat';
import type { NaviTool } from '../naviTool';

export type GetFocusCodeRegionsInput = {
	path?: string;
};

type GetFocusCodeRegionsResult = {
	activeIndex: number;
	targets: ChatFocusTarget[];
};

type GetFocusCodeRegionsDeps = {
	getCurrentSessionId: () => string;
	getFocusRegions: (sessionId: string, input: GetFocusCodeRegionsInput) => Promise<GetFocusCodeRegionsResult>;
	resolveWorkspaceRoot?: () => string | undefined;
};

export function createGetFocusCodeRegionsTool(deps: GetFocusCodeRegionsDeps): NaviTool {
	const resolveWorkspaceRoot = deps.resolveWorkspaceRoot ?? getWorkspaceRoot;
	return {
		name: 'get_focus_code_regions',
		description:
			'List all current focus highlight regions in the active session. Optional input path filters to one file. Input JSON: {} or {"path":"src/file.ts"}. Use this tool before switching/clearing highlights when you need ids and current ordering.',
		func: async (rawInput: string) => {
			const workspaceRoot = resolveWorkspaceRoot();
			if (!workspaceRoot) {
				return errorResult('No workspace folder is open.');
			}

			const input = parseInput(rawInput);
			if (input.path) {
				const normalizedPath = normalizePath(input.path);
				const targetPath = resolvePathInsideWorkspace(workspaceRoot, normalizedPath);
				if (!targetPath) {
					return errorResult('Path is outside the workspace.');
				}
				input.path = normalizedPath;
			}

			const sessionId = deps.getCurrentSessionId();
			const result = await deps.getFocusRegions(sessionId, input);
			const activeFocusTarget =
				result.activeIndex >= 0 && result.activeIndex < result.targets.length
					? result.targets[result.activeIndex]
					: null;

			return JSON.stringify(
				{
					ok: true,
					sessionId,
					count: result.targets.length,
					activeIndex: result.activeIndex,
					activeFocusTarget,
					focusTargets: result.targets
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

function parseInput(rawInput: string): GetFocusCodeRegionsInput {
	const text = rawInput.trim();
	if (!text) {
		return {};
	}
	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text) as GetFocusCodeRegionsInput;
			return parsed ?? {};
		} catch {
			return { path: text };
		}
	}
	return { path: text };
}

function resolvePathInsideWorkspace(workspaceRoot: string, requestedPath: string): string | undefined {
	const target = path.resolve(workspaceRoot, requestedPath);
	const relative = path.relative(workspaceRoot, target);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		return undefined;
	}
	return target;
}

function normalizePath(inputPath: string): string {
	return inputPath.trim().replace(/\\/g, '/');
}

function errorResult(message: string): string {
	return JSON.stringify({ ok: false, error: message }, null, 2);
}
