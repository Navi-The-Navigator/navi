import * as path from 'path';
import type { ChatFocusTarget } from '../../types/chat';
import type { NaviTool } from '../naviTool';
import { errorResult, parseInput, successResult } from './_shared.js';
import { getWorkspaceRoot } from './editorGateway.js';

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

			const input = parseInput<GetFocusCodeRegionsInput>(rawInput, (text) => ({ path: text }));
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

			return successResult({
				sessionId,
				count: result.targets.length,
				activeIndex: result.activeIndex,
				activeFocusTarget,
				focusTargets: result.targets
			});
		}
	};
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
