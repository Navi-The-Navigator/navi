import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import type { NaviTool } from '../naviTool';

type WorkspaceRootResolver = () => string | undefined;

type SearchFileContentInput = {
	query?: string;
	path?: string;
	maxResults?: number;
	maxMatchesPerFile?: number;
	caseSensitive?: boolean;
	includeHidden?: boolean;
};

const DEFAULT_MAX_RESULTS = 40;
const DEFAULT_MAX_MATCHES_PER_FILE = 5;
const MAX_FILE_SIZE_BYTES = 1024 * 1024;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'out']);

export function createSearchFileContentTool(
	resolveWorkspaceRoot: WorkspaceRootResolver = getWorkspaceRoot
): NaviTool {
	return {
		name: 'search_file_content',
		description:
			'Search text inside workspace files. Input can be plain text query or JSON: {"query":"ping","path":"src","maxResults":40,"maxMatchesPerFile":5,"caseSensitive":false}.',
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
			const maxMatchesPerFile = clampInteger(input.maxMatchesPerFile, DEFAULT_MAX_MATCHES_PER_FILE, 1, 20);
			const caseSensitive = input.caseSensitive ?? false;
			const includeHidden = input.includeHidden ?? false;
			const searchNeedle = caseSensitive ? query : query.toLowerCase();
			const results: Array<{ path: string; line: number; snippet: string }> = [];

			const walk = async (dirPath: string): Promise<void> => {
				if (results.length >= maxResults) {
					return;
				}
				const entries = await fs.readdir(dirPath, { withFileTypes: true });
				entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
				for (const entry of entries) {
					if (results.length >= maxResults) {
						return;
					}
					if (!includeHidden && entry.name.startsWith('.')) {
						continue;
					}
					if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
						continue;
					}

					const fullPath = path.join(dirPath, entry.name);
					if (entry.isDirectory()) {
						await walk(fullPath);
						continue;
					}

					const fileStat = await fs.stat(fullPath).catch(() => undefined);
					if (!fileStat || fileStat.size > MAX_FILE_SIZE_BYTES) {
						continue;
					}

					const content = await fs.readFile(fullPath, 'utf8').catch(() => undefined);
					if (content === undefined || content.includes('\u0000')) {
						continue;
					}

					const lines = content.split(/\r?\n/);
					let matchesInFile = 0;
					for (let i = 0; i < lines.length; i += 1) {
						if (results.length >= maxResults || matchesInFile >= maxMatchesPerFile) {
							break;
						}
						const line = lines[i];
						const haystack = caseSensitive ? line : line.toLowerCase();
						if (!haystack.includes(searchNeedle)) {
							continue;
						}
						results.push({
							path: normalizeRelativePath(path.relative(workspaceRoot, fullPath)),
							line: i + 1,
							snippet: line.trim().slice(0, 240)
						});
						matchesInFile += 1;
					}
				}
			};

			await walk(basePath);

			return JSON.stringify(
				{
					query,
					searchPath: normalizeRelativePath(path.relative(workspaceRoot, basePath)) || '.',
					caseSensitive,
					maxResults,
					maxMatchesPerFile,
					count: results.length,
					truncated: results.length >= maxResults,
					results
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

function parseInput(rawInput: string): SearchFileContentInput {
	const text = rawInput.trim();
	if (!text) {
		return {};
	}
	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text) as SearchFileContentInput;
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
