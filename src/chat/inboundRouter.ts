import * as vscode from 'vscode';
import { logAgentFlow } from '../agent/debugLogger.js';
import type { FocusController } from '../focus/focusController.js';
import type { SettingsManager } from '../settings/settingsCommands.js';
import type { ChatInboundMessage } from '../types/chat';
import type { ChatMessenger } from './chatMessenger.js';
import type { GenerationController } from './generationController.js';
import type { ChatSessionStore } from './sessionStore.js';

/**
 * Routes inbound `chat:*` messages from the chat webview to the session store,
 * focus controller and generation controller, and pushes the resulting state
 * back to both webviews.
 */
export class ChatInboundRouter {
	constructor(
		private readonly sessionStore: ChatSessionStore,
		private readonly focusController: FocusController,
		private readonly generationController: GenerationController,
		private readonly messenger: ChatMessenger,
		private readonly settingsManager: SettingsManager,
		private readonly postFocusStateToFocusView: (sessionId: string) => Promise<void>
	) {}

	public async handle(message: ChatInboundMessage): Promise<void> {
		if (message.type === 'chat:ready') {
			await this.syncSessionsToWebview();
			return;
		}

		if (message.type === 'chat:newSession') {
			if (this.generationController.isCurrentlyGenerating()) {
				await this.postError('The current reply is still in progress. Please wait before starting a new chat.');
				return;
			}

			this.sessionStore.createSession();
			this.focusController.refreshDecorations();
			this.focusController.updateStatusBar();
			await this.postFocusStateToFocusView(this.sessionStore.getCurrentSessionId());
			await this.syncSessionsToWebview();
			return;
		}

		if (message.type === 'chat:switchSession') {
			if (this.generationController.isCurrentlyGenerating()) {
				await this.postError('The current reply is still in progress. Please wait before switching chats.');
				return;
			}

			const sessionId = message.sessionId ?? '';
			if (!sessionId || !this.sessionStore.switchSession(sessionId)) {
				await this.postError('That chat no longer exists.');
				return;
			}

			this.focusController.refreshDecorations();
			this.focusController.updateStatusBar();
			await this.postFocusStateToFocusView(this.sessionStore.getCurrentSessionId());
			await this.syncSessionsToWebview();
			return;
		}

		if (message.type === 'chat:renameSession') {
			const sessionId = message.sessionId ?? '';
			const nextTitle = (message.title ?? '').trim();
			if (!sessionId || !nextTitle) {
				await this.postError('Rename failed: the title cannot be empty.');
				return;
			}

			const renamed = this.sessionStore.renameSession(sessionId, nextTitle);
			if (!renamed) {
				await this.postError('Rename failed: that chat no longer exists.');
				return;
			}

			await this.syncSessionsToWebview();
			return;
		}

		if (message.type === 'chat:deleteSession') {
			if (this.generationController.isCurrentlyGenerating()) {
				await this.postError('The current reply is still in progress. Please wait before deleting a chat.');
				return;
			}

			const sessionId = message.sessionId ?? '';
			if (!sessionId) {
				await this.postError('Delete failed: that chat no longer exists.');
				return;
			}

			const confirm = await vscode.window.showWarningMessage(
				'Delete this chat?',
				{ modal: true },
				'Delete'
			);
			if (confirm !== 'Delete') {
				return;
			}

			const deleted = this.sessionStore.deleteSession(sessionId);
			if (!deleted) {
				await this.postError('Delete failed: that chat no longer exists.');
				return;
			}

			this.focusController.deleteSessionData(sessionId);
			this.focusController.refreshDecorations();
			this.focusController.updateStatusBar();
			await this.postFocusStateToFocusView(this.sessionStore.getCurrentSessionId());
			await this.syncSessionsToWebview();
			return;
		}

		if (message.type === 'chat:revealFocusTarget') {
			const sessionId = message.sessionId ?? this.sessionStore.getCurrentSessionId();
			const target = this.focusController.getActiveFocusTarget(sessionId);
			if (!target) {
				await this.postError('This chat has no focus regions to jump to yet.');
				return;
			}

			await this.focusController.revealFocusTarget(sessionId, target);
			await this.messenger.postFocusTarget(sessionId, this.focusController.getActiveFocusTarget(sessionId) ?? null);
			await this.postFocusStateToFocusView(sessionId);
			return;
		}

		if (message.type === 'chat:openSettings') {
			await this.settingsManager.openSettings();
			return;
		}

		if (message.type === 'chat:toggleRunCollapsed') {
			const sessionId = this.sessionStore.getCurrentSessionId();
			const runId = (message.runId ?? '').trim();
			if (!runId) {
				return;
			}
			this.sessionStore.setRunCollapsed(sessionId, runId, !!message.collapsed);
			const run = this.sessionStore.getRun(sessionId, runId);
			if (run) {
				await this.messenger.postRunState(sessionId, run);
			}
			return;
		}

		if (message.type === 'chat:cancelGeneration') {
			await this.generationController.requestCancellation();
			return;
		}

		if (message.type !== 'chat:userMessage') {
			return;
		}

		const prompt = (message.text ?? '').trim();
		if (!prompt) {
			return;
		}

		const sessionId = this.sessionStore.getCurrentSessionId();
		this.sessionStore.appendMessage(sessionId, 'user', prompt);
		await this.generationController.handleUserMessage(prompt);
	}

	public async createNewSession(): Promise<void> {
		if (this.generationController.isCurrentlyGenerating() || !this.messenger.hasActiveWebview()) {
			return;
		}
		this.sessionStore.createSession();
		this.focusController.refreshDecorations();
		this.focusController.updateStatusBar();
		await this.postFocusStateToFocusView(this.sessionStore.getCurrentSessionId());
		await this.syncSessionsToWebview();
	}

	private async syncSessionsToWebview(): Promise<void> {
		const currentSessionId = this.sessionStore.getCurrentSessionId();
		await this.messenger.postSessions(this.sessionStore.getSessions(), currentSessionId);
		await this.messenger.postTodos(currentSessionId, this.sessionStore.getTodos(currentSessionId));
		await this.messenger.postFocusTarget(
			currentSessionId,
			this.focusController.getActiveFocusTarget(currentSessionId) ?? null
		);
		await this.messenger.postSessionState(currentSessionId, this.sessionStore.getViewState(currentSessionId));
	}

	private async postError(text: string): Promise<void> {
		logAgentFlow('main.extension', 'postError', {
			text,
			activeSessionId: this.sessionStore.getCurrentSessionId(),
			activeGenerationSessionId: this.generationController.getActiveSessionId()
		});
		await this.messenger.postError(text);
	}
}
