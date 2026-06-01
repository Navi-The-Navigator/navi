import * as path from 'path';
import type { ChatFocusTarget } from '../../types/chat';
import type { NaviTool } from '../naviTool';
import { errorResult, parseInput, successResult } from './_shared.js';
import { getWorkspaceRoot } from './editorGateway.js';

export type ClearFocusCodeRegionInput = {
	id?: string;
	path?: string;
	startLine?: number;
	endLine?: number;
	clearAll?: boolean;
};

type ClearFocusCodeRegionResult = {
	removedCount: number;
	remainingCount: number;
	activeFocusTarget: ChatFocusTarget | null;
};

type ClearFocusCodeRegionDeps = {
	getCurrentSessionId: () => string;
	clearFocusRegions: (sessionId: string, input: ClearFocusCodeRegionInput) => Promise<ClearFocusCodeRegionResult>;
	resolveWorkspaceRoot?: () => string | undefined;
};

export function createClearFocusCodeRegionTool(deps: ClearFocusCodeRegionDeps): NaviTool {
	const resolveWorkspaceRoot = deps.resolveWorkspaceRoot ?? getWorkspaceRoot;
	return {
		name: 'clear_focus_code_region',
		description:
			'Clear highlight regions previously created by focus_user_code_region. Use when a focused task is completed, obsolete, or incorrect. Supports clearing by id (preferred), or by path with optional line range. Set clearAll=true to remove all regions in current session. Input JSON: {"id":"focus-..."} or {"path":"src/file.ts","startLine":20,"endLine":40} or {"clearAll":true}.',
		func: async (rawInput: string) => {
			const workspaceRoot = resolveWorkspaceRoot();
			if (!workspaceRoot) {
				return errorResult('No workspace folder is open.');
			}

			const input = parseInput<ClearFocusCodeRegionInput>(rawInput, (text) => ({ id: text }));
			if (!input.clearAll) {
				const hasId = !!(input.id ?? '').trim();
				const hasPath = !!(input.path ?? '').trim();
				if (!hasId && !hasPath) {
					return errorResult('Provide id or path, or set clearAll=true.');
				}
			}

			if (input.path) {
				const normalizedPath = normalizePath(input.path);
				const targetPath = resolvePathInsideWorkspace(workspaceRoot, normalizedPath);
				if (!targetPath) {
					return errorResult('Path is outside the workspace.');
				}
				input.path = normalizedPath;
			}

			const sessionId = deps.getCurrentSessionId();
			const result = await deps.clearFocusRegions(sessionId, input);
			return successResult({
				sessionId,
				removedCount: result.removedCount,
				remainingCount: result.remainingCount,
				activeFocusTarget: result.activeFocusTarget
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
