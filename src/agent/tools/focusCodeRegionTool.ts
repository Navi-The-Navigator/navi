import * as path from 'path';
import type { ChatFocusTarget } from '../../types/chat';
import type { NaviTool } from '../naviTool';
import { errorResult, parseInput, successResult } from './_shared.js';
import { fileExists, getWorkspaceRoot } from './editorGateway.js';

export type FocusCodeRegionInput = {
	path?: string;
	startLine?: number;
	endLine?: number;
	title?: string;
	instruction?: string;
};

type FocusCodeRegionDeps = {
	getCurrentSessionId: () => string;
	focusRegion: (sessionId: string, input: FocusCodeRegionInput) => Promise<ChatFocusTarget>;
	resolveWorkspaceRoot?: () => string | undefined;
};

export function createFocusCodeRegionTool(deps: FocusCodeRegionDeps): NaviTool {
	const resolveWorkspaceRoot = deps.resolveWorkspaceRoot ?? getWorkspaceRoot;
	return {
		name: 'focus_user_code_region',
		description:
			'Reveal and highlight where the user should write code next. Use this when assigning coding steps. Input JSON: {"path":"src/file.ts","startLine":10,"endLine":18,"title":"Next coding task","instruction":"Implement the logic here"}.',
		func: async (rawInput: string) => {
			const workspaceRoot = resolveWorkspaceRoot();
			if (!workspaceRoot) {
				return errorResult('No workspace folder is open.');
			}

			const input = parseInput<FocusCodeRegionInput>(rawInput, (text) => ({ path: text }));
			if (!input.path || !input.path.trim()) {
				return errorResult('Missing required field: path.');
			}

			const normalizedPath = normalizePath(input.path);
			const targetPath = resolvePathInsideWorkspace(workspaceRoot, normalizedPath);
			if (!targetPath) {
				return errorResult('Path is outside the workspace.');
			}

			const exists = await fileExists(targetPath);
			if (!exists) {
				return errorResult('File not found.');
			}

			const sessionId = deps.getCurrentSessionId();
			const focused = await deps.focusRegion(sessionId, {
				...input,
				path: normalizedPath
			});

			return successResult({
				sessionId,
				focusTarget: focused
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
