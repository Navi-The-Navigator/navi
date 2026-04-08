import * as path from 'path';
import * as vscode from 'vscode';
import type { NaviTool } from '../naviTool';

type GetErrorsInput = {
	filePaths?: string[];
	paths?: string[];
	path?: string;
	maxItems?: number;
};

type GetErrorsDeps = {
	resolveWorkspaceRoot?: () => string | undefined;
	getAllDiagnostics?: () => ReadonlyArray<[vscode.Uri, readonly vscode.Diagnostic[]]>;
};

type SerializableDiagnostic = {
	path: string;
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	severity: 'error' | 'warning' | 'info' | 'hint';
	message: string;
	source?: string;
	code?: string;
};

const DEFAULT_MAX_ITEMS = 200;

export function createGetErrorsTool(deps: GetErrorsDeps = {}): NaviTool {
	const resolveWorkspaceRoot = deps.resolveWorkspaceRoot ?? getWorkspaceRoot;
	const getAllDiagnostics = deps.getAllDiagnostics ?? (() => vscode.languages.getDiagnostics());

	return {
		name: 'get_errors',
		description:
			'Read workspace diagnostics (errors, warnings, info, hints). Optional input JSON: {"filePaths":["src/file.ts"],"maxItems":200}. Also accepts "paths" or single "path".',
		func: async (rawInput: string) => {
			const input = parseInput(rawInput);
			const workspaceRoot = resolveWorkspaceRoot();
			const all = getAllDiagnostics();
			const requestedPathSet = resolveRequestedPaths(input, workspaceRoot);

			const diagnostics = flattenDiagnostics(all, {
				workspaceRoot,
				requestedPathSet,
				maxItems: normalizeMaxItems(input.maxItems)
			});

			const summary = summarizeBySeverity(diagnostics);
			return JSON.stringify(
				{
					ok: true,
					workspaceRoot: workspaceRoot ?? null,
					requestedPaths: requestedPathSet ? Array.from(requestedPathSet.values()) : [],
					summary,
					diagnostics
				},
				null,
				2
			);
		}
	};
}

function getWorkspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function parseInput(rawInput: string): GetErrorsInput {
	const text = rawInput.trim();
	if (!text) {
		return {};
	}

	if (text.startsWith('{')) {
		try {
			return JSON.parse(text) as GetErrorsInput;
		} catch {
			return { path: text };
		}
	}

	return { path: text };
}

function resolveRequestedPaths(input: GetErrorsInput, workspaceRoot: string | undefined): Set<string> | undefined {
	const rawPaths = [
		...(Array.isArray(input.filePaths) ? input.filePaths : []),
		...(Array.isArray(input.paths) ? input.paths : []),
		...(typeof input.path === 'string' && input.path.trim() ? [input.path] : [])
	];

	if (!rawPaths.length) {
		return undefined;
	}

	const resolved = new Set<string>();
	for (const item of rawPaths) {
		const trimmed = item.trim();
		if (!trimmed) {
			continue;
		}

		const absolute = path.isAbsolute(trimmed)
			? path.normalize(trimmed)
			: workspaceRoot
				? path.resolve(workspaceRoot, trimmed)
				: undefined;

		if (absolute) {
			resolved.add(normalizeCasePath(absolute));
		}
	}

	return resolved.size ? resolved : undefined;
}

function flattenDiagnostics(
	entries: ReadonlyArray<[vscode.Uri, readonly vscode.Diagnostic[]]>,
	options: {
		workspaceRoot?: string;
		requestedPathSet?: Set<string>;
		maxItems: number;
	}
): SerializableDiagnostic[] {
	const out: SerializableDiagnostic[] = [];
	const workspaceRoot = options.workspaceRoot;
	const normalizedWorkspaceRoot = workspaceRoot ? normalizeCasePath(path.normalize(workspaceRoot)) : undefined;

	for (const [uri, fileDiagnostics] of entries) {
		if (!fileDiagnostics.length) {
			continue;
		}

		const fsPath = path.normalize(uri.fsPath);
		const normalizedPath = normalizeCasePath(fsPath);

		if (normalizedWorkspaceRoot && !isPathInside(normalizedWorkspaceRoot, normalizedPath)) {
			continue;
		}

		if (options.requestedPathSet && !options.requestedPathSet.has(normalizedPath)) {
			continue;
		}

		const displayPath = toDisplayPath(fsPath, workspaceRoot);
		for (const diagnostic of fileDiagnostics) {
			out.push({
				path: displayPath,
				line: diagnostic.range.start.line + 1,
				column: diagnostic.range.start.character + 1,
				endLine: diagnostic.range.end.line + 1,
				endColumn: diagnostic.range.end.character + 1,
				severity: mapSeverity(diagnostic.severity),
				message: diagnostic.message,
				source: diagnostic.source,
				code: stringifyCode(diagnostic.code)
			});

			if (out.length >= options.maxItems) {
				return out;
			}
		}
	}

	return out;
}

function normalizeMaxItems(value: number | undefined): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_MAX_ITEMS;
	}
	const intValue = Math.trunc(value as number);
	if (intValue <= 0) {
		return DEFAULT_MAX_ITEMS;
	}
	return Math.min(intValue, 1000);
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
	const relative = path.relative(rootPath, candidatePath);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toDisplayPath(filePath: string, workspaceRoot: string | undefined): string {
	if (!workspaceRoot) {
		return filePath.replace(/\\/g, '/');
	}

	const relative = path.relative(workspaceRoot, filePath);
	if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
		return relative.replace(/\\/g, '/');
	}

	return filePath.replace(/\\/g, '/');
}

function mapSeverity(severity: vscode.DiagnosticSeverity): 'error' | 'warning' | 'info' | 'hint' {
	if (severity === vscode.DiagnosticSeverity.Error) {
		return 'error';
	}
	if (severity === vscode.DiagnosticSeverity.Warning) {
		return 'warning';
	}
	if (severity === vscode.DiagnosticSeverity.Information) {
		return 'info';
	}
	return 'hint';
}

function stringifyCode(code: vscode.Diagnostic['code']): string | undefined {
	if (!code) {
		return undefined;
	}
	if (typeof code === 'string') {
		return code;
	}
	if (typeof code === 'number') {
		return String(code);
	}
	if (typeof code === 'object' && 'value' in code) {
		const value = code.value;
		if (typeof value === 'string' || typeof value === 'number') {
			return String(value);
		}
	}
	return undefined;
}

function summarizeBySeverity(diagnostics: SerializableDiagnostic[]): Record<string, number> {
	const summary = {
		error: 0,
		warning: 0,
		info: 0,
		hint: 0,
		total: diagnostics.length
	};

	for (const item of diagnostics) {
		summary[item.severity] += 1;
	}

	return summary;
}

function normalizeCasePath(filePath: string): string {
	return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}