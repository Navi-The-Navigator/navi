import * as path from 'path';
import { DynamicTool } from '@langchain/core/tools';
import * as vscode from 'vscode';
import type { ChatFocusTarget } from '../../types/chat';

export type FocusCodeRegionInput = {
	path?: string;
	startLine?: number;
	endLine?: number;
	anchorText?: string;
	title?: string;
	instruction?: string;
};

type FocusCodeRegionDeps = {
	getCurrentSessionId: () => string;
	focusRegion: (sessionId: string, input: FocusCodeRegionInput) => Promise<ChatFocusTarget>;
	resolveWorkspaceRoot?: () => string | undefined;
};

export function createFocusCodeRegionTool(deps: FocusCodeRegionDeps): DynamicTool {
	const resolveWorkspaceRoot = deps.resolveWorkspaceRoot ?? getWorkspaceRoot;
	return new DynamicTool({
		name: 'focus_user_code_region',
		description:
			'Reveal and highlight where the user should write code next. Use this when assigning coding steps. IMPORTANT: (1) Highlight a continuous edit block, not just a single line; usually cover at least 3 lines unless the change is truly one-line. (2) endLine must include the last line the user needs to touch. (3) For insert-after cases, include surrounding context lines instead of only the insertion point. (4) Multiple focus regions are allowed; call this tool repeatedly to build a navigable set of highlights for the session. (5) Re-check location with read_file/search_file_content before calling to reduce line drift. (6) When a region is done or wrong, use clear_focus_code_region to remove it by id/path. Input JSON: {"path":"src/file.ts","startLine":10,"endLine":18,"anchorText":"function foo(","title":"Next coding task","instruction":"Implement the logic here"}.',
		func: async (rawInput) => {
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
	});
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
