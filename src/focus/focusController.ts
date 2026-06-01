import * as path from 'path';
import * as vscode from 'vscode';
import type { ClearFocusCodeRegionInput } from '../agent/tools/clearFocusCodeRegionTool';
import type { FocusCodeRegionInput } from '../agent/tools/focusCodeRegionTool';
import type { GetFocusCodeRegionsInput } from '../agent/tools/getFocusCodeRegionsTool';
import type { JumpToFocusInput } from '../agent/tools/jumpToFocusTool';
import type { ChatMessenger } from '../chat/chatMessenger.js';
import type { ChatSessionStore } from '../chat/sessionStore.js';
import type { ChatFocusTarget } from '../types/chat';
import { createFocusTargetId } from '../utils/id.js';
import { clampInteger } from '../utils/math.js';
import type { FocusDecorations } from './focusDecorations.js';
import type { FocusStatusBar } from './focusStatusBar.js';

const FOCUS_VIEW_TYPE = 'navi.focusWebview';
const MAX_TARGETS_PER_SESSION = 20;

/**
 * Owns the per-session focus-region state and all operations on it: creating,
 * revealing, cycling, clearing, document-change syncing, decorations and the
 * status bar. Posting to the chat webview goes through the injected messenger;
 * posting to the focus webview goes through the injected callback (kept as a
 * callback so the controller never imports the focus view provider).
 */
export class FocusController {
	private readonly focusTargetsBySessionId = new Map<string, ChatFocusTarget[]>();
	private readonly activeFocusIndexBySessionId = new Map<string, number>();

	constructor(
		private readonly sessionStore: ChatSessionStore,
		private readonly decorations: FocusDecorations,
		private readonly statusBar: FocusStatusBar,
		private readonly messenger: ChatMessenger,
		private readonly postFocusStateToFocusView: (sessionId: string) => Promise<void>
	) {}

	public getTargetsForSession(sessionId: string): ChatFocusTarget[] {
		return this.focusTargetsBySessionId.get(sessionId) ?? [];
	}

	public getTargetsByIds(sessionId: string, ids: string[]): ChatFocusTarget[] {
		const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		return targets.filter((target) => ids.includes(target.id));
	}

	public deleteSessionData(sessionId: string): void {
		this.focusTargetsBySessionId.delete(sessionId);
		this.activeFocusIndexBySessionId.delete(sessionId);
	}

	public refreshDecorations(): void {
		const sessionId = this.sessionStore.getCurrentSessionId();
		const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		this.decorations.refresh(
			targets,
			(fsPath) => this.toWorkspaceRelativePath(fsPath),
			(document, target) => this.toDocumentRange(document, target)
		);
	}

	public updateStatusBar(): void {
		const sessionId = this.sessionStore.getCurrentSessionId();
		const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		const index = targets.length > 0 ? this.getActiveFocusIndex(sessionId, targets.length) : -1;
		this.statusBar.update(targets, index, targets[index]);
	}

	public async focusRegion(sessionId: string, input: FocusCodeRegionInput): Promise<ChatFocusTarget> {
		const target = await this.resolveFocusTarget(sessionId, input);
		const targetIndex = this.upsertFocusTarget(sessionId, target);
		this.activeFocusIndexBySessionId.set(sessionId, targetIndex);
		await this.revealFocusView();
		await this.revealFocusTarget(sessionId, target);
		this.updateStatusBar();
		await this.postFocusTargetToChat(sessionId);
		await this.postFocusStateToFocusView(sessionId);
		return target;
	}

	public async clearFocusRegions(
		sessionId: string,
		input: ClearFocusCodeRegionInput
	): Promise<{ removedCount: number; remainingCount: number; activeFocusTarget: ChatFocusTarget | null }> {
		const currentTargets = [...(this.focusTargetsBySessionId.get(sessionId) ?? [])];
		if (currentTargets.length === 0) {
			return {
				removedCount: 0,
				remainingCount: 0,
				activeFocusTarget: null
			};
		}

		let nextTargets: ChatFocusTarget[];
		if (input.clearAll) {
			nextTargets = [];
		} else {
			const id = (input.id ?? '').trim();
			const pathFilter = (input.path ?? '').trim();
			const startLineFilter = input.startLine;
			const endLineFilter = input.endLine;

			nextTargets = currentTargets.filter((target) => {
				if (id && target.id === id) {
					return false;
				}

				if (!pathFilter || target.path !== pathFilter) {
					return true;
				}

				if (!Number.isFinite(startLineFilter) && !Number.isFinite(endLineFilter)) {
					return false;
				}

				const filterStart = clampInteger(startLineFilter, target.startLine, 1, Number.MAX_SAFE_INTEGER);
				const filterEnd = clampInteger(endLineFilter, filterStart, filterStart, Number.MAX_SAFE_INTEGER);
				const overlaps = !(target.endLine < filterStart || target.startLine > filterEnd);
				return !overlaps;
			});
		}

		const removedCount = currentTargets.length - nextTargets.length;
		if (nextTargets.length === 0) {
			this.focusTargetsBySessionId.delete(sessionId);
			this.activeFocusIndexBySessionId.delete(sessionId);
		} else {
			this.focusTargetsBySessionId.set(sessionId, nextTargets);
			const activeIndex = this.getActiveFocusIndex(sessionId, nextTargets.length);
			if (activeIndex >= nextTargets.length) {
				this.activeFocusIndexBySessionId.set(sessionId, nextTargets.length - 1);
			}
		}

		this.refreshDecorations();
		this.updateStatusBar();
		if (this.sessionStore.getCurrentSessionId() === sessionId) {
			await this.postFocusTargetToChat(sessionId);
		}

		await this.postFocusStateToFocusView(sessionId);
		return {
			removedCount,
			remainingCount: nextTargets.length,
			activeFocusTarget: this.getActiveFocusTarget(sessionId) ?? null
		};
	}

	public async getFocusRegions(
		sessionId: string,
		input: GetFocusCodeRegionsInput
	): Promise<{ activeIndex: number; targets: ChatFocusTarget[] }> {
		const pathFilter = (input.path ?? '').trim();
		const allTargets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		const targets = pathFilter ? allTargets.filter((target) => target.path === pathFilter) : [...allTargets];
		if (targets.length === 0) {
			return {
				activeIndex: -1,
				targets: []
			};
		}

		if (!pathFilter) {
			return {
				activeIndex: this.getActiveFocusIndex(sessionId, targets.length),
				targets
			};
		}

		const active = this.getActiveFocusTarget(sessionId);
		const activeIndex = active ? targets.findIndex((target) => target.id === active.id) : -1;
		return {
			activeIndex,
			targets
		};
	}

	public async jumpToFocus(
		sessionId: string,
		input: JumpToFocusInput
	): Promise<{ activeIndex: number; activeFocusTarget: ChatFocusTarget | null; count: number }> {
		const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		if (targets.length === 0) {
			throw new Error('Current session has no focus regions.');
		}

		const requestedId = (input.id ?? '').trim();
		let targetIndex = this.getActiveFocusIndex(sessionId, targets.length);
		if (requestedId) {
			targetIndex = targets.findIndex((target) => target.id === requestedId);
			if (targetIndex < 0) {
				throw new Error('Focus target not found.');
			}
		} else if (Number.isFinite(input.index)) {
			const requestedIndex = Math.trunc(input.index ?? -1);
			if (requestedIndex < 0 || requestedIndex >= targets.length) {
				throw new Error('Focus index is out of range.');
			}
			targetIndex = requestedIndex;
		}

		await this.activateFocusTargetByIndex(sessionId, targetIndex, true);
		return {
			activeIndex: this.getActiveFocusIndex(sessionId, targets.length),
			activeFocusTarget: this.getActiveFocusTarget(sessionId) ?? null,
			count: targets.length
		};
	}

	public async focusPrevious(): Promise<void> {
		await this.revealFocusView();
		await this.cycleFocusTarget(-1);
	}

	public async focusNext(): Promise<void> {
		await this.revealFocusView();
		await this.cycleFocusTarget(1);
	}

	public async cycleFocusTarget(delta: number): Promise<void> {
		const sessionId = this.sessionStore.getCurrentSessionId();
		const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		if (targets.length === 0) {
			void vscode.window.showInformationMessage('This chat has no focus regions to switch between yet.');
			return;
		}

		const currentIndex = this.getActiveFocusIndex(sessionId, targets.length);
		const nextIndex = (currentIndex + delta + targets.length) % targets.length;
		await this.activateFocusTargetByIndex(sessionId, nextIndex, true);
	}

	public async activateFocusTargetByIndex(sessionId: string, index: number, reveal: boolean): Promise<void> {
		const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		if (targets.length === 0) {
			return;
		}
		const normalizedIndex = clampInteger(index, targets.length - 1, 0, targets.length - 1);
		this.activeFocusIndexBySessionId.set(sessionId, normalizedIndex);
		const target = targets[normalizedIndex];
		if (reveal) {
			await this.revealFocusTarget(sessionId, target);
		}
		this.updateStatusBar();
		if (this.sessionStore.getCurrentSessionId() === sessionId) {
			await this.postFocusTargetToChat(sessionId);
		}
	}

	public getActiveFocusTarget(sessionId: string): ChatFocusTarget | undefined {
		const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		if (targets.length === 0) {
			return undefined;
		}
		const index = this.getActiveFocusIndex(sessionId, targets.length);
		return targets[index];
	}

	public async revealFocusTarget(sessionId: string, target: ChatFocusTarget): Promise<void> {
		const workspaceRoot = this.getWorkspaceRoot();
		if (!workspaceRoot) {
			throw new Error('No workspace folder is open.');
		}

		const absolutePath = this.resolvePathInsideWorkspace(workspaceRoot, target.path);
		if (!absolutePath) {
			throw new Error('Path is outside the workspace.');
		}

		const uri = vscode.Uri.file(absolutePath);
		const document = await vscode.workspace.openTextDocument(uri);
		const range = this.toSelectionRange(document, target);

		const editor = await vscode.window.showTextDocument(document, {
			preserveFocus: false,
			preview: false
		});

		editor.selection = new vscode.Selection(range.start, range.start);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
		this.refreshDecorations();
		this.updateStatusBar();
		if (this.sessionStore.getCurrentSessionId() === sessionId) {
			await this.postFocusTargetToChat(sessionId);
			await this.postFocusStateToFocusView(sessionId);
		}
	}

	public async revealFocusView(): Promise<void> {
		await vscode.commands.executeCommand('workbench.action.openAuxiliaryBar').then(
			() => undefined,
			() => undefined
		);
		await vscode.commands
			.executeCommand(`${FOCUS_VIEW_TYPE}.focus`)
			.then(() => undefined, () => undefined);
		await this.postFocusStateToFocusView(this.sessionStore.getCurrentSessionId());
	}

	public async syncFocusTargetsForDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
		const relativePath = this.toWorkspaceRelativePath(event.document.uri.fsPath);
		if (!relativePath || event.contentChanges.length === 0) {
			return;
		}

		let currentSessionChanged = false;
		for (const [sessionId, targets] of this.focusTargetsBySessionId.entries()) {
			let changed = false;
			const nextTargets = targets.map((target) => {
				if (target.path !== relativePath) {
					return target;
				}
				const nextTarget = this.applyDocumentChangesToFocusTarget(target, event.contentChanges);
				changed = changed || nextTarget.startLine !== target.startLine || nextTarget.endLine !== target.endLine;
				return nextTarget;
			});

			if (!changed) {
				continue;
			}

			this.focusTargetsBySessionId.set(sessionId, nextTargets);
			currentSessionChanged = currentSessionChanged || sessionId === this.sessionStore.getCurrentSessionId();
		}

		if (!currentSessionChanged) {
			return;
		}

		this.refreshDecorations();
		this.updateStatusBar();
		const currentSessionId = this.sessionStore.getCurrentSessionId();
		await this.postFocusTargetToChat(currentSessionId);
		await this.postFocusStateToFocusView(currentSessionId);
	}

	private async postFocusTargetToChat(sessionId: string): Promise<void> {
		await this.messenger.postFocusTarget(sessionId, this.getActiveFocusTarget(sessionId) ?? null);
	}

	private async resolveFocusTarget(sessionId: string, input: FocusCodeRegionInput): Promise<ChatFocusTarget> {
		const workspaceRoot = this.getWorkspaceRoot();
		if (!workspaceRoot) {
			throw new Error('No workspace folder is open.');
		}

		const requestedPath = (input.path ?? '').trim();
		if (!requestedPath) {
			throw new Error('Missing required field: path.');
		}

		const absolutePath = this.resolvePathInsideWorkspace(workspaceRoot, requestedPath);
		if (!absolutePath) {
			throw new Error('Path is outside the workspace.');
		}

		const uri = vscode.Uri.file(absolutePath);
		const document = await vscode.workspace.openTextDocument(uri);
		const range = this.resolveTargetRange(document, input);

		return {
			id: createFocusTargetId(),
			sessionId,
			path: this.normalizeRelativePath(path.relative(workspaceRoot, absolutePath)),
			startLine: range.start.line + 1,
			endLine: range.end.line + 1,
			title: (input.title ?? '').trim() || 'Next coding region',
			instruction: (input.instruction ?? '').trim(),
			updatedAt: Date.now()
		};
	}

	private resolveTargetRange(document: vscode.TextDocument, input: FocusCodeRegionInput): vscode.Range {
		const lineCount = Math.max(1, document.lineCount);
		const startLineIndex = clampInteger(input.startLine, 1, 1, lineCount) - 1;
		const endLineIndex = clampInteger(input.endLine, startLineIndex + 1, startLineIndex + 1, lineCount) - 1;
		return new vscode.Range(startLineIndex, 0, endLineIndex, 0);
	}

	private ensureNonEmptyRange(document: vscode.TextDocument, range: vscode.Range): vscode.Range {
		if (!range.isEmpty) {
			return range;
		}
		const line = document.lineAt(range.start.line);
		return new vscode.Range(range.start, line.range.end);
	}

	private toWorkspaceRelativePath(fsPath: string): string | undefined {
		const workspaceRoot = this.getWorkspaceRoot();
		if (!workspaceRoot) {
			return undefined;
		}
		const relative = path.relative(workspaceRoot, fsPath);
		if (relative.startsWith('..') || path.isAbsolute(relative)) {
			return undefined;
		}
		return this.normalizeRelativePath(relative);
	}

	private toDocumentRange(document: vscode.TextDocument, target: ChatFocusTarget): vscode.Range {
		const lineCount = Math.max(1, document.lineCount);
		const startLine = clampInteger(target.startLine, 1, 1, lineCount) - 1;
		const endLine = clampInteger(target.endLine, startLine + 1, startLine + 1, lineCount) - 1;
		return new vscode.Range(startLine, 0, endLine, 0);
	}

	private toSelectionRange(document: vscode.TextDocument, target: ChatFocusTarget): vscode.Range {
		const lineCount = Math.max(1, document.lineCount);
		const startLine = clampInteger(target.startLine, 1, 1, lineCount) - 1;
		const endLine = clampInteger(target.endLine, startLine + 1, startLine + 1, lineCount) - 1;
		const endCharacter = document.lineAt(endLine).range.end.character;
		return this.ensureNonEmptyRange(document, new vscode.Range(startLine, 0, endLine, endCharacter));
	}

	private upsertFocusTarget(sessionId: string, target: ChatFocusTarget): number {
		const targets = [...(this.focusTargetsBySessionId.get(sessionId) ?? [])];
		const existingIndex = targets.findIndex((candidate) => this.isSameFocusLocation(candidate, target));
		if (existingIndex >= 0) {
			const existingTarget = targets[existingIndex];
			targets[existingIndex] = {
				...existingTarget,
				...target,
				id: existingTarget.id,
				updatedAt: Date.now()
			};
			this.focusTargetsBySessionId.set(sessionId, targets);
			return existingIndex;
		}

		targets.push(target);
		if (targets.length > MAX_TARGETS_PER_SESSION) {
			targets.shift();
		}
		this.focusTargetsBySessionId.set(sessionId, targets);
		return targets.length - 1;
	}

	private isSameFocusLocation(left: ChatFocusTarget, right: ChatFocusTarget): boolean {
		return (
			left.path === right.path &&
			left.startLine === right.startLine &&
			left.endLine === right.endLine
		);
	}

	private getActiveFocusIndex(sessionId: string, targetCount: number): number {
		if (targetCount <= 0) {
			return 0;
		}
		const stored = this.activeFocusIndexBySessionId.get(sessionId) ?? targetCount - 1;
		const normalized = clampInteger(stored, targetCount - 1, 0, targetCount - 1);
		this.activeFocusIndexBySessionId.set(sessionId, normalized);
		return normalized;
	}

	private applyDocumentChangesToFocusTarget(
		target: ChatFocusTarget,
		changes: readonly vscode.TextDocumentContentChangeEvent[]
	): ChatFocusTarget {
		let startLine = target.startLine;
		let endLine = target.endLine;
		for (const change of changes) {
			const changeStartLine = change.range.start.line + 1;
			const changeEndLine = change.range.end.line + 1;
			const removedLineCount = change.range.end.line - change.range.start.line;
			const insertedLineCount = (change.text.match(/\n/g) ?? []).length;
			const delta = insertedLineCount - removedLineCount;

			if (delta === 0 && changeStartLine === changeEndLine) {
				continue;
			}

			if (changeEndLine < startLine) {
				startLine += delta;
				endLine += delta;
				continue;
			}

			if (changeStartLine > endLine) {
				continue;
			}

			if (changeStartLine < startLine) {
				startLine = Math.max(1, startLine + delta);
			}
			endLine = Math.max(startLine, endLine + delta);
		}

		return {
			...target,
			startLine,
			endLine,
			updatedAt: Date.now()
		};
	}

	private getWorkspaceRoot(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	private resolvePathInsideWorkspace(workspaceRoot: string, requestedPath: string): string | undefined {
		const target = path.resolve(workspaceRoot, requestedPath);
		const relative = path.relative(workspaceRoot, target);
		if (relative.startsWith('..') || path.isAbsolute(relative)) {
			return undefined;
		}
		return target;
	}

	private normalizeRelativePath(inputPath: string): string {
		return inputPath.split(path.sep).join('/');
	}
}
