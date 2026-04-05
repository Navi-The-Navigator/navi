import * as path from 'path';
import * as vscode from 'vscode';
import type { ChatFocusTarget } from '../../types/chat';
import type { NaviTool } from '../naviTool';

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

			const input = parseInput(rawInput);
			if (!input.path || !input.path.trim()) {
				return errorResult('Missing required field: path.');
			}

			const normalizedPath = normalizePath(input.path);
			const targetPath = resolvePathInsideWorkspace(workspaceRoot, normalizedPath);
			if (!targetPath) {
				return errorResult('Path is outside the workspace.');
			}

			const fileExists = await vscode.workspace.fs.stat(vscode.Uri.file(targetPath)).then(
				() => true,
				() => false
			);
			if (!fileExists) {
				return errorResult('File not found.');
			}

			const sessionId = deps.getCurrentSessionId();
			const focused = await deps.focusRegion(sessionId, {
				...input,
				path: normalizedPath
			});

			return JSON.stringify(
				{
					ok: true,
					sessionId,
					focusTarget: focused
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

function parseInput(rawInput: string): FocusCodeRegionInput {
	const text = rawInput.trim();
	if (!text) {
		return {};
	}
	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text) as FocusCodeRegionInput;
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
