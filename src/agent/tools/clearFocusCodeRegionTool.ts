import * as path from 'path';
import * as vscode from 'vscode';
import type { ChatFocusTarget } from '../../types/chat';
import type { NaviTool } from '../naviTool';

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

			const input = parseInput(rawInput);
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
			return JSON.stringify(
				{
					ok: true,
					sessionId,
					removedCount: result.removedCount,
					remainingCount: result.remainingCount,
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

function parseInput(rawInput: string): ClearFocusCodeRegionInput {
	const text = rawInput.trim();
	if (!text) {
		return {};
	}
	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text) as ClearFocusCodeRegionInput;
			return parsed ?? {};
		} catch {
			return { id: text };
		}
	}
	return { id: text };
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
