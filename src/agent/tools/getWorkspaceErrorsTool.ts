import * as path from 'path';
import * as vscode from 'vscode';
import type { NaviTool } from '../naviTool';

type WorkspaceRootResolver = () => string | undefined;

type WorkspaceDiagnostic = {
	uri: vscode.Uri;
	diagnostic: vscode.Diagnostic;
};

type DiagnosticsProvider = () => Array<[vscode.Uri, readonly vscode.Diagnostic[]]>;

type GetWorkspaceErrorsInput = {
	paths?: string[];
	includeWarnings?: boolean;
	maxResults?: number;
};

const DEFAULT_MAX_RESULTS = 100;

export function createGetWorkspaceErrorsTool(
	resolveWorkspaceRoot: WorkspaceRootResolver = getWorkspaceRoot,
	getDiagnostics: DiagnosticsProvider = () => vscode.languages.getDiagnostics()
): NaviTool {
	return {
		name: 'get_workspace_errors',
		description:
			'Read current workspace diagnostics. Defaults to errors only. Input can be empty, a plain path string, or JSON like {"paths":["src/extension.ts"],"includeWarnings":true,"maxResults":100}.',
		func: async (rawInput: string) => {
			const workspaceRoot = resolveWorkspaceRoot();
			if (!workspaceRoot) {
				return errorResult('No workspace folder is open.');
			}

			const input = parseInput(rawInput);
			const normalizedPaths = normalizePaths(input.paths);
			const pathSet = new Set<string>();
			for (const requestedPath of normalizedPaths) {
				const resolvedPath = resolvePathInsideWorkspace(workspaceRoot, requestedPath);
				if (!resolvedPath) {
					return errorResult(`Path is outside the workspace: ${requestedPath}`);
				}
				pathSet.add(normalizeRelativePath(path.relative(workspaceRoot, resolvedPath)));
			}

			const includeWarnings = input.includeWarnings ?? false;
			const maxResults = clampInteger(input.maxResults, DEFAULT_MAX_RESULTS, 10, 500);
			const diagnostics = flattenDiagnostics(getDiagnostics())
				.filter((entry) => isInsideWorkspace(workspaceRoot, entry.uri.fsPath))
				.filter((entry) => includeWarnings || entry.diagnostic.severity === vscode.DiagnosticSeverity.Error)
				.filter((entry) => {
					if (pathSet.size === 0) {
						return true;
					}
					const relativePath = normalizeRelativePath(path.relative(workspaceRoot, entry.uri.fsPath));
					return pathSet.has(relativePath);
				});

			const results = diagnostics.slice(0, maxResults).map((entry) => ({
				path: normalizeRelativePath(path.relative(workspaceRoot, entry.uri.fsPath)),
				line: entry.diagnostic.range.start.line + 1,
				column: entry.diagnostic.range.start.character + 1,
				endLine: entry.diagnostic.range.end.line + 1,
				endColumn: entry.diagnostic.range.end.character + 1,
				severity: mapSeverity(entry.diagnostic.severity),
				message: entry.diagnostic.message,
				source: entry.diagnostic.source,
				code: normalizeDiagnosticCode(entry.diagnostic.code)
			}));

			return JSON.stringify(
				{
					workspaceRoot: normalizeRelativePath(workspaceRoot),
					paths: normalizedPaths,
					includeWarnings,
					maxResults,
					count: results.length,
					truncated: diagnostics.length > maxResults,
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

function parseInput(rawInput: string): GetWorkspaceErrorsInput {
	const text = rawInput.trim();
	if (!text) {
		return {};
	}

	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text) as GetWorkspaceErrorsInput;
			return parsed ?? {};
		} catch {
			return {};
		}
	}

	return { paths: [text] };
}

function normalizePaths(paths: string[] | undefined): string[] {
	if (!Array.isArray(paths)) {
		return [];
	}

	return paths.map((item) => item.trim()).filter(Boolean);
}

function flattenDiagnostics(entries: Array<[vscode.Uri, readonly vscode.Diagnostic[]]>): WorkspaceDiagnostic[] {
	return entries.flatMap(([uri, diagnostics]) => diagnostics.map((diagnostic) => ({ uri, diagnostic })));
}

function resolvePathInsideWorkspace(workspaceRoot: string, requestedPath: string): string | undefined {
	const target = path.resolve(workspaceRoot, requestedPath);
	const relative = path.relative(workspaceRoot, target);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		return undefined;
	}
	return target;
}

function isInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
	const relative = path.relative(workspaceRoot, targetPath);
	return !relative.startsWith('..') && !path.isAbsolute(relative);
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

function mapSeverity(severity: vscode.DiagnosticSeverity): 'error' | 'warning' | 'information' | 'hint' {
	if (severity === vscode.DiagnosticSeverity.Warning) {
		return 'warning';
	}
	if (severity === vscode.DiagnosticSeverity.Information) {
		return 'information';
	}
	if (severity === vscode.DiagnosticSeverity.Hint) {
		return 'hint';
	}
	return 'error';
}

function normalizeDiagnosticCode(code: vscode.Diagnostic['code']): string | number | undefined {
	if (typeof code === 'string' || typeof code === 'number') {
		return code;
	}
	return code?.value;
}

function errorResult(message: string): string {
	return JSON.stringify({ error: message }, null, 2);
}