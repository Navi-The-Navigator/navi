import * as vscode from 'vscode';

/**
 * The single seam for the VS Code APIs that tools touch. Centralizes
 * workspace/diagnostic/filesystem access so tools stay testable (each tool
 * still accepts an injectable override for its specific dependency).
 */

/** First workspace folder's fs path, if any. */
export function getWorkspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** All current workspace diagnostics, keyed by file URI. */
export function getAllDiagnostics(): ReadonlyArray<[vscode.Uri, readonly vscode.Diagnostic[]]> {
	return vscode.languages.getDiagnostics();
}

/** True when a file exists at the given absolute path. */
export async function fileExists(absolutePath: string): Promise<boolean> {
	return vscode.workspace.fs.stat(vscode.Uri.file(absolutePath)).then(
		() => true,
		() => false
	);
}
