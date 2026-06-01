import * as vscode from 'vscode';
import { buildFocusActionPrompt, type FocusAction } from '../agent/config.js';
import type { ChatMessenger } from '../chat/chatMessenger.js';
import type { GenerationController } from '../chat/generationController.js';
import type { ChatSessionStore } from '../chat/sessionStore.js';
import type { ChatInboundMessage } from '../types/chat';
import type { FocusController } from './focusController.js';

/**
 * Webview view provider for the standalone Focus panel. Renders the focus shell,
 * routes inbound `focus:*` messages, and bridges focus actions (review/help) into
 * the chat generation pipeline.
 */
export class NaviFocusViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'navi.focusWebview';

	private activeFocusWebview?: vscode.Webview;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly getFocusHtml: (webview: vscode.Webview, extensionUri: vscode.Uri) => string,
		private readonly sessionStore: ChatSessionStore,
		private readonly focusController: FocusController,
		private readonly generationController: GenerationController,
		private readonly messenger: ChatMessenger
	) {}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.activeFocusWebview = webviewView.webview;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};
		webviewView.webview.html = this.getFocusHtml(webviewView.webview, this.extensionUri);
		webviewView.webview.onDidReceiveMessage(async (message: ChatInboundMessage) => {
			await this.handleInboundMessage(message);
		});
	}

	public async postFocusState(sessionId: string): Promise<void> {
		if (!this.activeFocusWebview) {
			return;
		}
		const result = await this.focusController.getFocusRegions(sessionId, {});
		await this.activeFocusWebview.postMessage({
			type: 'focus:state',
			sessionId,
			activeIndex: result.activeIndex,
			focusTargets: result.targets
		});
	}

	private async handleInboundMessage(message: ChatInboundMessage): Promise<void> {
		if (message.type === 'focus:ready') {
			await this.postFocusState(this.sessionStore.getCurrentSessionId());
			return;
		}

		if (message.type === 'focus:prev') {
			await this.focusController.focusPrevious();
			return;
		}

		if (message.type === 'focus:next') {
			await this.focusController.focusNext();
			return;
		}

		if (message.type === 'focus:revealById') {
			const sessionId = message.sessionId ?? this.sessionStore.getCurrentSessionId();
			const focusTargetId = (message.focusTargetId ?? '').trim();
			if (!focusTargetId) {
				return;
			}
			const targets = this.focusController.getTargetsForSession(sessionId);
			const index = targets.findIndex((target) => target.id === focusTargetId);
			if (index < 0) {
				return;
			}
			await this.focusController.activateFocusTargetByIndex(sessionId, index, true);
			await this.postFocusState(sessionId);
			return;
		}

		if (message.type === 'focus:reviewById') {
			const sessionId = message.sessionId ?? this.sessionStore.getCurrentSessionId();
			const focusTargetId = (message.focusTargetId ?? '').trim();
			if (!focusTargetId) {
				return;
			}
			await this.submitFocusActionPrompt(sessionId, [focusTargetId], 'review');
			return;
		}

		if (message.type === 'focus:helpById') {
			const sessionId = message.sessionId ?? this.sessionStore.getCurrentSessionId();
			const focusTargetId = (message.focusTargetId ?? '').trim();
			if (!focusTargetId) {
				return;
			}
			await this.submitFocusActionPrompt(sessionId, [focusTargetId], 'help');
			return;
		}

		if (message.type === 'focus:reviewSelected') {
			const sessionId = message.sessionId ?? this.sessionStore.getCurrentSessionId();
			await this.submitFocusActionPrompt(sessionId, message.focusTargetIds ?? [], 'review');
			return;
		}

		if (message.type === 'focus:helpSelected') {
			const sessionId = message.sessionId ?? this.sessionStore.getCurrentSessionId();
			await this.submitFocusActionPrompt(sessionId, message.focusTargetIds ?? [], 'help');
			return;
		}
	}

	private async submitFocusActionPrompt(
		sessionId: string,
		focusTargetIds: string[],
		action: FocusAction
	): Promise<void> {
		if (!this.messenger.hasActiveWebview()) {
			void vscode.window.showWarningMessage('The Chat panel is not open, so the Focus action could not be sent.');
			return;
		}
		if (this.generationController.isCurrentlyGenerating()) {
			await this.messenger.postError('Please wait for the current reply to finish before starting a new Focus action.');
			return;
		}

		const selectedTargets = this.focusController.getTargetsByIds(sessionId, focusTargetIds);
		if (selectedTargets.length === 0) {
			void vscode.window.showInformationMessage('Select at least one focus region in the Focus panel first.');
			return;
		}

		const { preview, prompt } = buildFocusActionPrompt(selectedTargets, action);
		this.sessionStore.appendMessage(sessionId, 'user', preview);
		await this.messenger.postExternalUserMessage(preview);
		await this.generationController.handleUserMessage(prompt);
	}
}
