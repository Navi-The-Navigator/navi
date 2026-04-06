import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import type { NaviTool } from '../naviTool';

type WorkspaceRootResolver = () => string | undefined;

type SearchFilesInput = {
	query?: string;
	path?: string;
	maxResults?: number;
	includeHidden?: boolean;
};

const DEFAULT_MAX_RESULTS = 60;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'out']);

export function createSearchFilesTool(resolveWorkspaceRoot: WorkspaceRootResolver = getWorkspaceRoot): NaviTool {
	return {
		name: 'search_files',
		description:
			'Search files and directories by name/path in workspace. Input can be plain text query or JSON: {"query":"websocket","path":"src","maxResults":60,"includeHidden":false}.',
		func: async (rawInput: string) => {
			const workspaceRoot = resolveWorkspaceRoot();
			if (!workspaceRoot) {
				return errorResult('No workspace folder is open.');
			}

			const input = parseInput(rawInput);
			const query = (input.query ?? '').trim();
			if (!query) {
				return errorResult('Missing required field: query.');
			}

			const basePath = resolvePathInsideWorkspace(workspaceRoot, input.path ?? '.');
			if (!basePath) {
				return errorResult('Path is outside the workspace.');
			}

			const stat = await fs.stat(basePath).catch(() => undefined);
			if (!stat || !stat.isDirectory()) {
				return errorResult('Search path does not exist or is not a directory.');
			}

			const maxResults = clampInteger(input.maxResults, DEFAULT_MAX_RESULTS, 10, 300);
			const includeHidden = input.includeHidden ?? false;
			const normalizedQuery = query.toLowerCase();
			const matches: Array<{ path: string; type: 'file' | 'directory' }> = [];

			const walk = async (dirPath: string): Promise<void> => {
				if (matches.length >= maxResults) {
					return;
				}
				const entries = await fs.readdir(dirPath, { withFileTypes: true });
				entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
				for (const entry of entries) {
					if (matches.length >= maxResults) {
						return;
					}
					if (!includeHidden && entry.name.startsWith('.')) {
						continue;
					}
					if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
						continue;
					}

					const fullPath = path.join(dirPath, entry.name);
					const relativePath = normalizeRelativePath(path.relative(workspaceRoot, fullPath));
					if (relativePath.toLowerCase().includes(normalizedQuery)) {
						matches.push({
							path: relativePath,
							type: entry.isDirectory() ? 'directory' : 'file'
						});
					}

					if (entry.isDirectory()) {
						await walk(fullPath);
					}
				}
			};

			await walk(basePath);

			return JSON.stringify(
				{
					query,
					searchPath: normalizeRelativePath(path.relative(workspaceRoot, basePath)) || '.',
					maxResults,
					count: matches.length,
					truncated: matches.length >= maxResults,
					results: matches
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

function parseInput(rawInput: string): SearchFilesInput {
	const text = rawInput.trim();
	if (!text) {
		return {};
	}
	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text) as SearchFilesInput;
			return parsed ?? {};
		} catch {
			return { query: text };
		}
	}
	return { query: text };
}

function resolvePathInsideWorkspace(workspaceRoot: string, requestedPath: string): string | undefined {
	const target = path.resolve(workspaceRoot, requestedPath);
	const relative = path.relative(workspaceRoot, target);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		return undefined;
	}
	return target;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return fallback;
	}
	const integer = Math.trunc(value as number);
	if (integer < min) {
		return min;
	}
	if (integer > max) {
		return max;
	}
	return integer;
}

function normalizeRelativePath(inputPath: string): string {
	return inputPath.split(path.sep).join('/');
}

function errorResult(message: string): string {
	return JSON.stringify({ error: message }, null, 2);
}
