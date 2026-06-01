import * as vscode from 'vscode';
import type { ChatFocusTarget } from '../types/chat';

/**
 * Owns the editor decoration used to highlight focus regions and applies/clears
 * it across the visible editors.
 */
export class FocusDecorations {
	private readonly decorationType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
		border: '1px solid',
		borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
		borderRadius: '3px'
	});

	public refresh(
		targets: ChatFocusTarget[],
		toWorkspaceRelativePath: (fsPath: string) => string | undefined,
		toDocumentRange: (document: vscode.TextDocument, target: ChatFocusTarget) => vscode.Range
	): void {
		for (const editor of vscode.window.visibleTextEditors) {
			const ranges: vscode.Range[] = [];
			const editorPath = toWorkspaceRelativePath(editor.document.uri.fsPath);
			if (editorPath) {
				for (const target of targets) {
					if (target.path !== editorPath) {
						continue;
					}
					ranges.push(toDocumentRange(editor.document, target));
				}
			}
			editor.setDecorations(this.decorationType, ranges);
		}
	}

	public clear(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			editor.setDecorations(this.decorationType, []);
		}
	}

	public dispose(): void {
		this.clear();
		this.decorationType.dispose();
	}
}
