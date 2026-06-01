import * as vscode from 'vscode';
import type { NaviChatGateway } from '../agent/gateway';
import { logAgentFlow, summarizeText } from '../agent/debugLogger.js';
import { createMainChatGateway } from '../agent/mainAgent.js';
import type { FocusController } from '../focus/focusController.js';
import type { SettingsManager } from '../settings/settingsCommands.js';
import { affectsModel } from '../settings/naviConfig.js';
import { ApiKeyGate } from './apiKeyGate.js';
import type { ChatMessenger } from './chatMessenger.js';
import type { ChatSessionStore } from './sessionStore.js';
import type { SubagentRunTracker } from './subagentRunTracker.js';

/**
 * Drives a single user turn end-to-end: owns the chat gateway, the generation
 * lifecycle flags (busy/cancel/abort), API-key gating, and streams the assistant
 * reply into the session store + chat webview while delegating subagent runs to
 * the tracker.
 */
export class GenerationController {
	private readonly gateway: NaviChatGateway;
	private readonly apiKeyGate: ApiKeyGate;
	private isGenerating = false;
	private cancelGenerationRequested = false;
	private activeGenerationAbortController?: AbortController;
	private activeGenerationSessionId?: string;

	constructor(
		private readonly sessionStore: ChatSessionStore,
		private readonly messenger: ChatMessenger,
		private readonly tracker: SubagentRunTracker,
		private readonly focusController: FocusController,
		private readonly settingsManager: SettingsManager,
		private readonly globalState: vscode.Memento
	) {
		this.apiKeyGate = new ApiKeyGate(this.globalState, this.settingsManager);
		this.gateway = createMainChatGateway({
			getCurrentSessionId: () => this.sessionStore.getCurrentSessionId(),
			getTodos: (sessionId) => this.sessionStore.getTodos(sessionId),
			addTodo: (sessionId, text) => this.sessionStore.addTodo(sessionId, text),
			deleteTodo: (sessionId, todoId) => this.sessionStore.deleteTodo(sessionId, todoId),
			updateTodoText: (sessionId, todoId, text) => this.sessionStore.updateTodoText(sessionId, todoId, text),
			setTodoCompleted: (sessionId, todoId, completed) =>
				this.sessionStore.setTodoCompleted(sessionId, todoId, completed),
			clearTodos: (sessionId, completedOnly) => this.sessionStore.clearTodos(sessionId, completedOnly),
			replaceTodos: (sessionId, todos) => this.sessionStore.replaceTodos(sessionId, todos),
			onTodosChanged: async (sessionId) => {
				await this.messenger.postTodos(sessionId, this.sessionStore.getTodos(sessionId));
			},
			focusRegion: async (sessionId, input) => this.focusController.focusRegion(sessionId, input),
			clearFocusRegions: async (sessionId, input) => this.focusController.clearFocusRegions(sessionId, input),
			getFocusRegions: async (sessionId, input) => this.focusController.getFocusRegions(sessionId, input),
			jumpToFocus: async (sessionId, input) => this.focusController.jumpToFocus(sessionId, input),
			onMainProgress: async (text) => {
				const sessionId = this.activeGenerationSessionId;
				if (sessionId) {
					this.sessionStore.appendStatusEntry(sessionId, 'progress', text);
				}
				await this.messenger.postToolStatus(text, false);
			}
		});
	}

	public isCurrentlyGenerating(): boolean {
		return this.isGenerating;
	}

	public getActiveSessionId(): string | undefined {
		return this.activeGenerationSessionId;
	}

	public async requestCancellation(): Promise<void> {
		if (!this.isGenerating) {
			return;
		}
		this.cancelGenerationRequested = true;
		this.activeGenerationAbortController?.abort();
		await this.messenger.postToolStatus('Cancelling the current reply…', true);
	}

	public async handleConfigurationChange(event: vscode.ConfigurationChangeEvent): Promise<void> {
		if (!this.didAffectChatModelConfiguration(event)) {
			return;
		}
		await this.gateway.invalidateAgent();
		await this.messenger.postToolStatus(
			'LLM settings updated. The next request will use the new configuration.',
			true
		);
	}

	public dispose(): void {
		void this.gateway.dispose();
	}

	public async handleUserMessage(prompt: string): Promise<void> {
		if (this.isGenerating) {
			logAgentFlow('main.extension', 'handleUserMessage:rejected_busy', {
				currentSessionId: this.sessionStore.getCurrentSessionId()
			});
			await this.postError('Please wait for the current reply to finish before sending another message.');
			return;
		}

		const canProceed = await this.apiKeyGate.ensureApiKey();
		if (!canProceed) {
			return;
		}

		this.isGenerating = true;
		this.cancelGenerationRequested = false;
		const generationAbortController = new AbortController();
		this.activeGenerationAbortController = generationAbortController;
		const startedAt = Date.now();
		let elapsedText = '';
		let shouldPersistElapsed = false;
		let generationCancelled = false;
		let generationFailed = false;
		let generationFailureMessage = '';
		const sessionId = this.sessionStore.getCurrentSessionId();
		this.activeGenerationSessionId = sessionId;
		const assistantRunId = this.sessionStore.startAssistantReply(sessionId);
		logAgentFlow('main.extension', 'handleUserMessage:start', {
			sessionId,
			assistantRunId,
			promptLength: prompt.length,
			promptPreview: summarizeText(prompt)
		});
		await this.messenger.postAssistantStart();

		try {
			this.sessionStore.updateSessionTitleIfNeeded(sessionId, prompt);
			await this.messenger.postSessions(
				this.sessionStore.getSessions(),
				this.sessionStore.getCurrentSessionId()
			);

			const assistantText = await this.gateway.streamAssistantReply(sessionId, prompt, {
				onAssistantDelta: async (delta: string, parentToolCallId?: string) => {
					if (parentToolCallId) {
						await this.tracker.handleSubagentAssistantDelta(sessionId, parentToolCallId, delta);
						return;
					}
					logAgentFlow('main.extension', 'callback:onAssistantDelta', {
						sessionId,
						assistantRunId,
						deltaLength: delta.length,
						deltaPreview: summarizeText(delta),
						activeSubagentRuns: this.tracker.getActiveRunCount()
					});
					this.sessionStore.appendAssistantDelta(sessionId, delta);
					await this.messenger.postAssistantDelta(delta);
				},
				onAgentEvent: async (event) => {
					await this.tracker.handleAgentEventForUi(sessionId, event);
				},
				shouldCancel: () => this.cancelGenerationRequested,
				abortSignal: generationAbortController.signal
			});
			logAgentFlow('main.extension', 'handleUserMessage:stream_returned', {
				sessionId,
				assistantRunId,
				assistantLength: assistantText.length,
				assistantPreview: summarizeText(assistantText),
				activeSubagentRuns: this.tracker.getActiveRunCount()
			});

			if (!assistantText.trim()) {
				logAgentFlow('main.extension', 'handleUserMessage:empty_response_fallback', {
					sessionId,
					assistantRunId,
					activeSubagentRuns: this.tracker.getActiveRunCount(),
					cancelRequested: this.cancelGenerationRequested
				});
				this.sessionStore.appendAssistantDelta(sessionId, 'I have not generated any displayable text response yet.');
				await this.messenger.postAssistantDelta('I have not generated any displayable text response yet.');
			}

			const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(2);
			elapsedText = `Elapsed: ${elapsedSeconds}s`;
			shouldPersistElapsed = true;
			logAgentFlow('main.extension', 'handleUserMessage:elapsed_ready', {
				sessionId,
				assistantRunId,
				elapsedText
			});
			await this.messenger.postElapsed(elapsedText);
		} catch (error) {
			const messageText = error instanceof Error ? error.message : 'Unknown error';
			generationCancelled = messageText.includes('cancelled by the user');
			generationFailed = !generationCancelled;
			generationFailureMessage = messageText;
			logAgentFlow('main.extension', 'handleUserMessage:error', {
				sessionId,
				assistantRunId,
				messageText,
				error,
				cancelRequested: this.cancelGenerationRequested
			});
			if (generationCancelled) {
				this.sessionStore.setAssistantError(sessionId, 'This reply was cancelled.');
				await this.messenger.postAssistantDelta('This reply was cancelled.');
				return;
			}
			this.sessionStore.setAssistantError(sessionId, `LLM request failed: ${messageText}`);
			await this.postError(`LLM request failed: ${messageText}`);
		} finally {
			logAgentFlow('main.extension', 'handleUserMessage:finally_before_finish', {
				sessionId,
				assistantRunId,
				shouldPersistElapsed,
				elapsedText,
				generationCancelled,
				generationFailed,
				activeSubagentRuns: this.tracker.getActiveRunCount()
			});
			this.sessionStore.finishAssistantReply(sessionId);
			if (shouldPersistElapsed && elapsedText) {
				this.sessionStore.appendStatusEntry(sessionId, 'elapsed', elapsedText);
			}
			if (generationCancelled) {
				await this.tracker.finalizeActiveRuns(sessionId, 'cancelled');
			} else if (generationFailed && this.tracker.getActiveRunCount() > 0) {
				await this.tracker.finalizeActiveRuns(sessionId, 'error', generationFailureMessage);
			} else {
				this.tracker.resetTracking();
				await this.messenger.postToolStatusSuspended(false);
			}
			this.isGenerating = false;
			this.cancelGenerationRequested = false;
			this.activeGenerationSessionId = undefined;
			if (this.activeGenerationAbortController === generationAbortController) {
				this.activeGenerationAbortController = undefined;
			}
			await this.messenger.postAssistantDone();
			logAgentFlow('main.extension', 'handleUserMessage:finished', {
				sessionId,
				assistantRunId,
				shouldPersistElapsed,
				elapsedText
			});
		}
	}

	private async postError(text: string): Promise<void> {
		logAgentFlow('main.extension', 'postError', {
			text,
			activeSessionId: this.sessionStore.getCurrentSessionId(),
			activeGenerationSessionId: this.activeGenerationSessionId
		});
		await this.messenger.postError(text);
	}

	private didAffectChatModelConfiguration(event: vscode.ConfigurationChangeEvent): boolean {
		return affectsModel(event);
	}

}
