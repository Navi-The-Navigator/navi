import * as path from 'path';
import { promises as fs } from 'fs';
import { DynamicTool } from '@langchain/core/tools';
import * as vscode from 'vscode';

type WorkspaceRootResolver = () => string | undefined;

type ProjectStructureInput = {
	path?: string;
	maxDepth?: number;
	maxEntries?: number;
	includeHidden?: boolean;
};

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_ENTRIES = 300;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'out']);

export function createProjectStructureTool(resolveWorkspaceRoot: WorkspaceRootResolver = getWorkspaceRoot): DynamicTool {
	return new DynamicTool({
		name: 'read_project_structure',
		description:
			'Read workspace project structure as a tree. Input can be a path string, or JSON like {"path":"src","maxDepth":3,"maxEntries":300,"includeHidden":false}.',
		func: async (rawInput) => {
			const workspaceRoot = resolveWorkspaceRoot();
			if (!workspaceRoot) {
				return errorResult('No workspace folder is open.');
			}

			const input = parseInput(rawInput);
			const targetPath = resolvePathInsideWorkspace(workspaceRoot, input.path ?? '.');
			if (!targetPath) {
				return errorResult('Path is outside the workspace.');
			}

			const stat = await fs.stat(targetPath).catch(() => undefined);
			if (!stat || !stat.isDirectory()) {
				return errorResult('Target path does not exist or is not a directory.');
			}

			const maxDepth = clampInteger(input.maxDepth, DEFAULT_MAX_DEPTH, 0, 8);
			const maxEntries = clampInteger(input.maxEntries, DEFAULT_MAX_ENTRIES, 20, 2000);
			const includeHidden = input.includeHidden ?? false;

			const lines: string[] = [];
			let entriesVisited = 0;
			let truncated = false;

			const relativeRoot = normalizeRelativePath(path.relative(workspaceRoot, targetPath));
			lines.push(relativeRoot ? `${relativeRoot}/` : './');

			const walk = async (dirPath: string, depth: number): Promise<void> => {
				if (truncated) {
					return;
				}

				const entries = await fs.readdir(dirPath, { withFileTypes: true });
				entries.sort((a, b) => {
					if (a.isDirectory() && !b.isDirectory()) {
						return -1;
					}
					if (!a.isDirectory() && b.isDirectory()) {
						return 1;
					}
					return a.name.localeCompare(b.name, 'en');
				});

				for (const entry of entries) {
					if (!includeHidden && entry.name.startsWith('.')) {
						continue;
					}
					if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
						continue;
					}

					entriesVisited += 1;
					if (entriesVisited > maxEntries) {
						truncated = true;
						lines.push(`${'  '.repeat(depth + 1)}... (truncated)`);
						return;
					}

					const suffix = entry.isDirectory() ? '/' : '';
					lines.push(`${'  '.repeat(depth + 1)}- ${entry.name}${suffix}`);

					if (entry.isDirectory() && depth < maxDepth) {
						await walk(path.join(dirPath, entry.name), depth + 1);
					}
				}
			};

			await walk(targetPath, 0);

			return JSON.stringify(
				{
					workspaceRoot: normalizeRelativePath(workspaceRoot),
					targetPath: relativeRoot || '.',
					maxDepth,
					maxEntries,
					entriesVisited,
					truncated,
					tree: lines.join('\n')
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

function parseInput(rawInput: string): ProjectStructureInput {
	const text = rawInput.trim();
	if (!text) {
		return {};
	}

	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text) as ProjectStructureInput;
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

function normalizeRelativePath(inputPath: string): string {
	return inputPath.split(path.sep).join('/');
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

function errorResult(message: string): string {
	return JSON.stringify({ error: message }, null, 2);
}