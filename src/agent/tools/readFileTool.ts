import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import type { NaviTool } from '../naviTool';

type WorkspaceRootResolver = () => string | undefined;

type ReadFileInput = {
	path?: string;
	startLine?: number;
	endLine?: number;
	maxChars?: number;
};

const DEFAULT_MAX_CHARS = 12000;
const DEFAULT_LINE_WINDOW = 200;

export function createReadFileTool(resolveWorkspaceRoot: WorkspaceRootResolver = getWorkspaceRoot): NaviTool {
	return {
		name: 'read_file',
		description:
			'Read a file from workspace with line numbers. Input can be a plain path or JSON like {"path":"src/extension.ts","startLine":1,"endLine":120,"maxChars":12000}.',
		func: async (rawInput: string) => {
			const workspaceRoot = resolveWorkspaceRoot();
			if (!workspaceRoot) {
				return errorResult('No workspace folder is open.');
			}

			const input = parseInput(rawInput);
			if (!input.path || !input.path.trim()) {
				return errorResult('Missing required field: path.');
			}

			const targetPath = resolvePathInsideWorkspace(workspaceRoot, input.path);
			if (!targetPath) {
				return errorResult('Path is outside the workspace.');
			}

			const stat = await fs.stat(targetPath).catch(() => undefined);
			if (!stat) {
				return errorResult('File not found.');
			}
			if (!stat.isFile()) {
				return errorResult('Target path is not a file.');
			}

			const content = await fs.readFile(targetPath, 'utf8');
			const lines = content.split(/\r?\n/);
			const totalLines = lines.length;

			const startLine = clampInteger(input.startLine, 1, 1, Math.max(1, totalLines));
			const computedEnd = input.endLine
				? clampInteger(input.endLine, totalLines, startLine, totalLines)
				: Math.min(totalLines, startLine + DEFAULT_LINE_WINDOW - 1);
			const maxChars = clampInteger(input.maxChars, DEFAULT_MAX_CHARS, 1000, 30000);

			const selected = lines.slice(startLine - 1, computedEnd);
			const lineNumberWidth = String(computedEnd).length;
			const rendered = selected
				.map((line, index) => `${String(startLine + index).padStart(lineNumberWidth, ' ')}| ${line}`)
				.join('\n');

			const truncated = rendered.length > maxChars;
			const finalContent = truncated ? `${rendered.slice(0, maxChars)}\n... (truncated by maxChars)` : rendered;

			return JSON.stringify(
				{
					path: normalizeRelativePath(path.relative(workspaceRoot, targetPath)),
					totalLines,
					startLine,
					endLine: computedEnd,
					maxChars,
					truncated,
					content: finalContent
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

function parseInput(rawInput: string): ReadFileInput {
	const text = rawInput.trim();
	if (!text) {
		return {};
	}

	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text) as ReadFileInput;
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