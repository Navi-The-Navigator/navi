import * as vscode from 'vscode';
import * as path from 'path';
import type { SessionEvent } from '@github/copilot-sdk';
import type { NaviChatGateway } from './agent/chatGateway';
import {
	CODE_EXPLORATION_AGENT_DISPLAY_NAME,
	CODE_EXPLORATION_AGENT_NAME,
	CODE_REVIEW_AGENT_DISPLAY_NAME,
	CODE_REVIEW_AGENT_NAME,
	PLANNING_AGENT_DISPLAY_NAME,
	PLANNING_AGENT_NAME
} from './agent/agents/customAgents.js';
import { buildFocusActionPrompt, type FocusAction } from './agent/config.js';
import { logAgentFlow, summarizeText } from './agent/debugLogger.js';
import { createMainChatGateway } from './agent/mainAgent.js';
import type { ClearFocusCodeRegionInput } from './agent/tools/clearFocusCodeRegionTool';
import type { FocusCodeRegionInput } from './agent/tools/focusCodeRegionTool';
import type { GetFocusCodeRegionsInput } from './agent/tools/getFocusCodeRegionsTool';
import type { JumpToFocusInput } from './agent/tools/jumpToFocusTool';
import { ChatSessionStore } from './chat/sessionStore.js';
import { SettingsManager } from './settings/settingsManager.js';
import type { ChatFocusTarget, ChatInboundMessage, ChatRun } from './types/chat';
import { createFocusTargetId } from './utils/id.js';
import { getFocusHtml } from './webview/focusHtml.js';
import { getSidebarHtml } from './webview/sidebarHtml.js';

class NaviSidebarViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'navi.sidebarWebview';
	public static readonly focusViewType = 'navi.focusWebview';
	private static readonly envApiKeyConfirmedStateKey = 'navi.confirmedEnvApiKey';
	public static readonly focusSwitcherCommand = 'navi.focusSwitcher';
	public static readonly focusPrevCommand = 'navi.focusPrev';
	public static readonly focusNextCommand = 'navi.focusNext';

	private readonly sessionStore = new ChatSessionStore();
	private readonly gateway: NaviChatGateway;
	private readonly settingsManager = new SettingsManager();
	private readonly focusTargetsBySessionId = new Map<string, ChatFocusTarget[]>();
	private readonly activeFocusIndexBySessionId = new Map<string, number>();
	private readonly focusDecorationType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
		border: '1px solid',
		borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
		borderRadius: '3px'
	});
	private readonly focusSwitcherStatusBar = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100
	);
	private readonly focusNextStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
	private readonly focusPrevStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
	private readonly disposables: vscode.Disposable[] = [];
	private isGenerating = false;
	private cancelGenerationRequested = false;
	private activeGenerationAbortController?: AbortController;
	private activeGenerationSessionId?: string;
	private readonly activeSubagentRunIds = new Set<string>();
	private readonly subagentRunIdsByParentToolCallId = new Map<string, string>();
	private readonly subagentRunIdsByToolCallId = new Map<string, string>();
	private readonly subagentToolNamesByToolCallId = new Map<string, string>();
	public activeWebview?: vscode.Webview;
	private activeFocusWebview?: vscode.Webview;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly globalState: vscode.Memento
	) {
		this.focusSwitcherStatusBar.command = NaviSidebarViewProvider.focusSwitcherCommand;
		this.focusSwitcherStatusBar.tooltip = '切换待编辑高亮区域';
		this.focusPrevStatusBar.command = NaviSidebarViewProvider.focusPrevCommand;
		this.focusPrevStatusBar.text = '$(chevron-left)';
		this.focusPrevStatusBar.tooltip = '跳到上一个高亮区域';
		this.focusNextStatusBar.command = NaviSidebarViewProvider.focusNextCommand;
		this.focusNextStatusBar.text = '$(chevron-right)';
		this.focusNextStatusBar.tooltip = '跳到下一个高亮区域';
		this.focusSwitcherStatusBar.hide();
		this.focusPrevStatusBar.hide();
		this.focusNextStatusBar.hide();
		this.disposables.push(
			vscode.window.onDidChangeVisibleTextEditors(() => {
				this.refreshFocusDecorationsForCurrentSession();
			}),
			vscode.window.onDidChangeActiveTextEditor(() => {
				this.refreshFocusDecorationsForCurrentSession();
				this.updateFocusSwitcherStatusBar();
			}),
			vscode.workspace.onDidChangeConfiguration(async (event) => {
				if (!this.didAffectChatModelConfiguration(event)) {
					return;
				}

				await this.gateway.invalidateAgent();
				if (!this.activeWebview) {
					return;
				}

				await this.activeWebview.postMessage({
					type: 'chat:toolStatus',
					text: '检测到 LLM 设置已更新，下一次请求会使用新配置。',
					transient: true
				});
			}),
			vscode.workspace.onDidChangeTextDocument(async (event) => {
				await this.syncFocusTargetsForDocumentChange(event);
			})
		);
		this.updateFocusSwitcherStatusBar();

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
				await this.postTodosToActiveWebview(sessionId);
			},
			focusRegion: async (sessionId, input) => this.focusUserCodeRegion(sessionId, input),
			clearFocusRegions: async (sessionId, input) => this.clearFocusRegions(sessionId, input),
			getFocusRegions: async (sessionId, input) => this.getFocusRegions(sessionId, input),
			jumpToFocus: async (sessionId, input) => this.jumpToFocus(sessionId, input),
			onMainProgress: async (text) => {
				const sessionId = this.activeGenerationSessionId;
				if (sessionId) {
					this.sessionStore.appendStatusEntry(sessionId, 'progress', text);
				}
				if (!this.activeWebview) {
					return;
				}
				await this.activeWebview.postMessage({
					type: 'chat:toolStatus',
					text,
					transient: false
				});
			}
		});
	}

	public dispose(): void {
		this.clearFocusHighlight();
		this.focusSwitcherStatusBar.dispose();
		this.focusPrevStatusBar.dispose();
		this.focusNextStatusBar.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.focusDecorationType.dispose();
		void this.gateway.dispose();
	}

	public async showFocusSwitcher(): Promise<void> {
		await this.revealFocusView();
	}

	public async focusPrevious(): Promise<void> {
		await this.revealFocusView();
		await this.cycleFocusTarget(-1);
	}

	public async focusNext(): Promise<void> {
		await this.revealFocusView();
		await this.cycleFocusTarget(1);
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		if (webviewView.viewType === NaviSidebarViewProvider.focusViewType) {
			this.activeFocusWebview = webviewView.webview;
			webviewView.webview.options = {
				enableScripts: true,
				localResourceRoots: [this.extensionUri]
			};
			webviewView.webview.html = getFocusHtml(webviewView.webview, this.extensionUri);
			webviewView.webview.onDidReceiveMessage(async (message: ChatInboundMessage) => {
				await this.handleFocusInboundMessage(webviewView.webview, message);
			});
			return;
		}

		this.activeWebview = webviewView.webview;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		webviewView.webview.html = getSidebarHtml(webviewView.webview, this.extensionUri);
		webviewView.webview.onDidReceiveMessage(async (message: ChatInboundMessage) => {
			await this.handleInboundMessage(webviewView.webview, message);
		});
	}

	private async handleFocusInboundMessage(webview: vscode.Webview, message: ChatInboundMessage): Promise<void> {
		if (message.type === 'focus:ready') {
			const sessionId = this.sessionStore.getCurrentSessionId();
			await this.postFocusState(webview, sessionId);
			return;
		}

		if (message.type === 'focus:prev') {
			await this.focusPrevious();
			return;
		}

		if (message.type === 'focus:next') {
			await this.focusNext();
			return;
		}

		if (message.type === 'focus:revealById') {
			const sessionId = message.sessionId ?? this.sessionStore.getCurrentSessionId();
			const focusTargetId = (message.focusTargetId ?? '').trim();
			if (!focusTargetId) {
				return;
			}
			const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
			const index = targets.findIndex((target) => target.id === focusTargetId);
			if (index < 0) {
				return;
			}
			await this.activateFocusTargetByIndex(sessionId, index, true);
			await this.postFocusState(webview, sessionId);
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

	private async handleInboundMessage(webview: vscode.Webview, message: ChatInboundMessage): Promise<void> {
		if (message.type === 'chat:ready') {
			await this.syncSessionsToWebview(webview);
			return;
		}

		if (message.type === 'chat:newSession') {
			if (this.isGenerating) {
				await this.postError(webview, '当前回答尚未完成，请稍后再新建会话。');
				return;
			}

			this.sessionStore.createSession();
			this.refreshFocusDecorationsForCurrentSession();
			this.updateFocusSwitcherStatusBar();
			await this.postFocusStateToActiveFocusWebview(this.sessionStore.getCurrentSessionId());
			await this.syncSessionsToWebview(webview);
			return;
		}

		if (message.type === 'chat:switchSession') {
			if (this.isGenerating) {
				await this.postError(webview, '当前回答尚未完成，请稍后再切换会话。');
				return;
			}

			const sessionId = message.sessionId ?? '';
			if (!sessionId || !this.sessionStore.switchSession(sessionId)) {
				await this.postError(webview, '目标会话不存在。');
				return;
			}

			this.refreshFocusDecorationsForCurrentSession();
			this.updateFocusSwitcherStatusBar();
			await this.postFocusStateToActiveFocusWebview(this.sessionStore.getCurrentSessionId());
			await this.syncSessionsToWebview(webview);
			return;
		}

		if (message.type === 'chat:renameSession') {
			const sessionId = message.sessionId ?? '';
			const nextTitle = (message.title ?? '').trim();
			if (!sessionId || !nextTitle) {
				await this.postError(webview, '重命名失败：标题不能为空。');
				return;
			}

			const renamed = this.sessionStore.renameSession(sessionId, nextTitle);
			if (!renamed) {
				await this.postError(webview, '重命名失败：会话不存在。');
				return;
			}

			await this.syncSessionsToWebview(webview);
			return;
		}

		if (message.type === 'chat:deleteSession') {
			if (this.isGenerating) {
				await this.postError(webview, '当前回答尚未完成，请稍后再删除会话。');
				return;
			}

			const sessionId = message.sessionId ?? '';
			if (!sessionId) {
				await this.postError(webview, '删除失败：会话不存在。');
				return;
			}

			const confirm = await vscode.window.showWarningMessage(
				'确定要删除这个会话吗？',
				{ modal: true },
				'删除'
			);
			if (confirm !== '删除') {
				return;
			}

			const deleted = this.sessionStore.deleteSession(sessionId);
			if (!deleted) {
				await this.postError(webview, '删除失败：会话不存在。');
				return;
			}

			this.focusTargetsBySessionId.delete(sessionId);
			this.activeFocusIndexBySessionId.delete(sessionId);
			this.refreshFocusDecorationsForCurrentSession();
			this.updateFocusSwitcherStatusBar();
			await this.postFocusStateToActiveFocusWebview(this.sessionStore.getCurrentSessionId());
			await this.syncSessionsToWebview(webview);
			return;
		}

		if (message.type === 'chat:revealFocusTarget') {
			const sessionId = message.sessionId ?? this.sessionStore.getCurrentSessionId();
			const target = this.getActiveFocusTarget(sessionId);
			if (!target) {
				await this.postError(webview, '当前会话还没有可跳转的待编辑区域。');
				return;
			}

			await this.revealFocusTarget(sessionId, target);
			await this.postFocusTarget(webview, sessionId);
			await this.postFocusStateToActiveFocusWebview(sessionId);
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
			await this.postRunStateToActiveWebview(sessionId, runId);
			return;
		}

		if (message.type === 'chat:cancelGeneration') {
			if (this.isGenerating) {
				this.cancelGenerationRequested = true;
				this.activeGenerationAbortController?.abort();
				await webview.postMessage({
					type: 'chat:toolStatus',
					text: '正在取消当前回复...',
					transient: true
				});
			}
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
		await this.handleUserMessage(webview, prompt);
	}

	private async handleUserMessage(webview: vscode.Webview, prompt: string): Promise<void> {
		if (this.isGenerating) {
			logAgentFlow('main.extension', 'handleUserMessage:rejected_busy', {
				currentSessionId: this.sessionStore.getCurrentSessionId()
			});
			await this.postError(webview, '请等待当前回答完成后再发送下一条消息。');
			return;
		}

		const canProceed = await this.ensureApiKeyBeforeFirstMessage();
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
		await webview.postMessage({ type: 'chat:assistantStart' });

		try {
			this.sessionStore.updateSessionTitleIfNeeded(sessionId, prompt);
			await this.postSessionSummary(webview);

			const assistantText = await this.gateway.streamAssistantReply(sessionId, prompt, {
				onAssistantDelta: async (delta: string, event) => {
					const parentToolCallId = event.data.parentToolCallId;
					if (parentToolCallId) {
						await this.handleSubagentAssistantDelta(sessionId, parentToolCallId, delta);
						return;
					}
					logAgentFlow('main.extension', 'callback:onAssistantDelta', {
						sessionId,
						assistantRunId,
						deltaLength: delta.length,
						deltaPreview: summarizeText(delta),
						activeSubagentRuns: this.activeSubagentRunIds.size
					});
					this.sessionStore.appendAssistantDelta(sessionId, delta);
					await webview.postMessage({
						type: 'chat:assistantDelta',
						text: delta
					});
				},
				onSessionEvent: async (event) => {
					await this.handleSessionEventForUi(sessionId, webview, event);
				},
				shouldCancel: () => this.cancelGenerationRequested,
				abortSignal: generationAbortController.signal
			});
			logAgentFlow('main.extension', 'handleUserMessage:stream_returned', {
				sessionId,
				assistantRunId,
				assistantLength: assistantText.length,
				assistantPreview: summarizeText(assistantText),
				activeSubagentRuns: this.activeSubagentRunIds.size
			});

			if (!assistantText.trim()) {
				logAgentFlow('main.extension', 'handleUserMessage:empty_response_fallback', {
					sessionId,
					assistantRunId,
					activeSubagentRuns: this.activeSubagentRunIds.size,
					cancelRequested: this.cancelGenerationRequested
				});
				this.sessionStore.appendAssistantDelta(sessionId, '我暂时没有生成可显示的文本响应。');
				await webview.postMessage({
					type: 'chat:assistantDelta',
					text: '我暂时没有生成可显示的文本响应。'
				});
			}

			const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(2);
			elapsedText = `用时：${elapsedSeconds}s`;
			shouldPersistElapsed = true;
			logAgentFlow('main.extension', 'handleUserMessage:elapsed_ready', {
				sessionId,
				assistantRunId,
				elapsedText
			});
			await webview.postMessage({
				type: 'chat:elapsed',
				text: elapsedText
			});
		} catch (error) {
			const messageText = error instanceof Error ? error.message : 'Unknown error';
			generationCancelled = messageText.includes('用户已取消');
			generationFailed = !generationCancelled;
			generationFailureMessage = messageText;
			logAgentFlow('main.extension', 'handleUserMessage:error', {
				sessionId,
				assistantRunId,
				messageText,
				error,
				cancelRequested: this.cancelGenerationRequested
			});
			if (messageText.includes('用户已取消')) {
				this.sessionStore.setAssistantError(sessionId, '已取消本次回复。');
				await webview.postMessage({
					type: 'chat:assistantDelta',
					text: '已取消本次回复。'
				});
				return;
			}
			this.sessionStore.setAssistantError(sessionId, `请求 LLM 失败：${messageText}`);
			await this.postError(webview, `请求 LLM 失败：${messageText}`);
		} finally {
			logAgentFlow('main.extension', 'handleUserMessage:finally_before_finish', {
				sessionId,
				assistantRunId,
				shouldPersistElapsed,
				elapsedText,
				generationCancelled,
				generationFailed,
				activeSubagentRuns: this.activeSubagentRunIds.size
			});
			this.sessionStore.finishAssistantReply(sessionId);
			if (shouldPersistElapsed && elapsedText) {
				this.sessionStore.appendStatusEntry(sessionId, 'elapsed', elapsedText);
			}
			if (generationCancelled) {
				await this.finalizeActiveSubagentRuns(sessionId, 'cancelled');
			} else if (generationFailed && this.activeSubagentRunIds.size > 0) {
				await this.finalizeActiveSubagentRuns(sessionId, 'error', generationFailureMessage);
			} else {
				this.resetActiveSubagentTracking();
				await this.setMainToolStatusSuspended(false);
			}
			this.isGenerating = false;
			this.cancelGenerationRequested = false;
			this.activeGenerationSessionId = undefined;
			if (this.activeGenerationAbortController === generationAbortController) {
				this.activeGenerationAbortController = undefined;
			}
			await webview.postMessage({ type: 'chat:assistantDone' });
			logAgentFlow('main.extension', 'handleUserMessage:finished', {
				sessionId,
				assistantRunId,
				shouldPersistElapsed,
				elapsedText
			});
		}
	}

	private resetActiveSubagentTracking(): void {
		this.activeSubagentRunIds.clear();
		this.subagentRunIdsByParentToolCallId.clear();
		this.subagentRunIdsByToolCallId.clear();
		this.subagentToolNamesByToolCallId.clear();
	}

	private async finalizeActiveSubagentRuns(
		sessionId: string,
		status: 'cancelled' | 'error',
		errorText?: string
	): Promise<void> {
		const activeRunIds = [...this.activeSubagentRunIds];
		logAgentFlow('main.extension.subagent', 'finalize_active_runs', {
			sessionId,
			status,
			activeRunIds,
			errorText
		});

		for (const runId of activeRunIds) {
			const run = this.sessionStore.getRun(sessionId, runId);
			if (!run || run.status !== 'running') {
				continue;
			}

			const elapsedText = Number.isFinite(run.startedAt)
				? this.formatElapsedText(Date.now() - run.startedAt)
				: undefined;

			if (status === 'cancelled') {
				this.sessionStore.finishRun(sessionId, runId, {
					status: 'cancelled',
					elapsedText
				});
			} else {
				this.sessionStore.failRun(sessionId, runId, errorText || '主请求提前结束，子任务未完成。', elapsedText);
			}

			await this.postRunStateToActiveWebview(sessionId, runId);
		}

		this.resetActiveSubagentTracking();
		await this.setMainToolStatusSuspended(false);
	}

	private async ensureApiKeyBeforeFirstMessage(): Promise<boolean> {
		const config = vscode.workspace.getConfiguration('navi');
		const authMode = (config.get<string>('authMode') ?? 'copilot').trim().toLowerCase();

		// Copilot mode: no API key needed (authentication via GitHub)
		if (authMode === 'copilot') {
			return true;
		}

		// BYOK mode: require an API key
		const configuredApiKey = (config.get<string>('apiKey') ?? '').trim();
		if (configuredApiKey) {
			return true;
		}

		const envApiKey = (process.env.NAVI_API_KEY ?? '').trim();
		if (envApiKey) {
			const hasConfirmedEnvApiKey = this.globalState.get<boolean>(
				NaviSidebarViewProvider.envApiKeyConfirmedStateKey,
				false
			);
			if (hasConfirmedEnvApiKey) {
				return true;
			}

			const choice = await vscode.window.showInformationMessage(
				'检测到环境变量中的 API Key。当前未在 VS Code 中配置 API Key。是否先使用环境变量继续？',
				{ modal: true },
				'使用环境变量',
				'去设置 Key'
			);

			if (choice === '使用环境变量') {
				await this.globalState.update(NaviSidebarViewProvider.envApiKeyConfirmedStateKey, true);
				return true;
			}

			if (choice === '去设置 Key') {
				await this.settingsManager.openApiKeySettings();
				const refreshedApiKey = (config.get<string>('apiKey') ?? '').trim();
				if (refreshedApiKey) {
					return true;
				}
				return false;
			}

			return false;
		}

		const setupChoice = await vscode.window.showWarningMessage(
			'BYOK 模式下还没有可用的 API Key。是否现在去设置？',
			{ modal: true },
			'去设置 Key',
			'切换到 Copilot 模式'
		);
		if (setupChoice === '去设置 Key') {
			await this.settingsManager.openApiKeySettings();
			const updatedApiKey = (config.get<string>('apiKey') ?? '').trim();
			return !!updatedApiKey;
		}
		if (setupChoice === '切换到 Copilot 模式') {
			await config.update('authMode', 'copilot', vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage('已切换到 GitHub Copilot 模式。');
			return true;
		}
		return false;
	}

	private async postError(webview: vscode.Webview, text: string): Promise<void> {
		logAgentFlow('main.extension', 'postError', {
			text,
			activeSessionId: this.sessionStore.getCurrentSessionId(),
			activeGenerationSessionId: this.activeGenerationSessionId
		});
		await webview.postMessage({
			type: 'chat:error',
			text
		});
	}

	private didAffectChatModelConfiguration(event: vscode.ConfigurationChangeEvent): boolean {
		return (
			event.affectsConfiguration('navi.authMode') ||
			event.affectsConfiguration('navi.apiKey') ||
			event.affectsConfiguration('navi.apiBaseUrl') ||
			event.affectsConfiguration('navi.model') ||
			event.affectsConfiguration('navi.temperature') ||
			event.affectsConfiguration('navi.mcpEnabled') ||
			event.affectsConfiguration('navi.mcpServersJson')
		);
	}

	private async postSessionSummary(webview: vscode.Webview): Promise<void> {
		await webview.postMessage({
			type: 'chat:sessions',
			sessions: this.sessionStore.getSessions(),
			currentSessionId: this.sessionStore.getCurrentSessionId()
		});
	}

	private async postTodos(webview: vscode.Webview, sessionId: string): Promise<void> {
		await webview.postMessage({
			type: 'chat:todos',
			sessionId,
			todos: this.sessionStore.getTodos(sessionId)
		});
	}

	private async postTodosToActiveWebview(sessionId: string): Promise<void> {
		if (!this.activeWebview) {
			return;
		}
		await this.postTodos(this.activeWebview, sessionId);
	}

	private async postSessionViewState(webview: vscode.Webview, sessionId: string): Promise<void> {
		await webview.postMessage({
			type: 'chat:sessionState',
			sessionId,
			state: this.sessionStore.getViewState(sessionId)
		});
	}

	private async postRunState(webview: vscode.Webview, sessionId: string, run: ChatRun): Promise<void> {
		await webview.postMessage({
			type: 'chat:runState',
			sessionId,
			run
		});
	}

	private async postRunStateToActiveWebview(sessionId: string, runId: string): Promise<void> {
		if (!this.activeWebview) {
			return;
		}
		const run = this.sessionStore.getRun(sessionId, runId);
		if (!run) {
			return;
		}
		await this.postRunState(this.activeWebview, sessionId, run);
	}

	private async setMainToolStatusSuspended(suppressed: boolean): Promise<void> {
		if (!this.activeWebview) {
			return;
		}
		await this.activeWebview.postMessage({
			type: suppressed ? 'chat:toolStatusSuspend' : 'chat:toolStatusResume'
		});
	}

	private async postFocusTarget(webview: vscode.Webview, sessionId: string): Promise<void> {
		await webview.postMessage({
			type: 'chat:focusTarget',
			sessionId,
			focusTarget: this.getActiveFocusTarget(sessionId) ?? null
		});
	}

	private async postFocusTargetToActiveWebview(sessionId: string): Promise<void> {
		if (!this.activeWebview) {
			return;
		}
		await this.postFocusTarget(this.activeWebview, sessionId);
	}

	private async postFocusState(webview: vscode.Webview, sessionId: string): Promise<void> {
		const result = await this.getFocusRegions(sessionId, {});
		await webview.postMessage({
			type: 'focus:state',
			sessionId,
			activeIndex: result.activeIndex,
			focusTargets: result.targets
		});
	}

	private async postFocusStateToActiveFocusWebview(sessionId: string): Promise<void> {
		if (!this.activeFocusWebview) {
			return;
		}
		await this.postFocusState(this.activeFocusWebview, sessionId);
	}

	private async syncSessionsToWebview(webview: vscode.Webview): Promise<void> {
		const currentSessionId = this.sessionStore.getCurrentSessionId();
		await this.postSessionSummary(webview);
		await this.postTodos(webview, currentSessionId);
		await this.postFocusTarget(webview, currentSessionId);
		await this.postSessionViewState(webview, currentSessionId);
	}

	public async createNewSession(): Promise<void> {
		if (this.isGenerating || !this.activeWebview) {
			return;
		}
		this.sessionStore.createSession();
		this.refreshFocusDecorationsForCurrentSession();
		this.updateFocusSwitcherStatusBar();
		await this.postFocusStateToActiveFocusWebview(this.sessionStore.getCurrentSessionId());
		await this.syncSessionsToWebview(this.activeWebview);
	}

	private async handleSessionEventForUi(
		sessionId: string,
		webview: vscode.Webview,
		event: SessionEvent
	): Promise<void> {
		switch (event.type) {
			case 'tool.execution_start':
				await this.handleToolExecutionStart(sessionId, webview, event);
				break;
			case 'tool.execution_progress':
				await this.handleToolExecutionProgress(sessionId, event);
				break;
			case 'tool.execution_complete':
				await this.handleToolExecutionComplete(sessionId, webview, event);
				break;
			case 'subagent.started':
				await this.handleSubagentStarted(sessionId, event);
				break;
			case 'subagent.completed':
				await this.handleSubagentCompleted(sessionId, event);
				break;
			case 'subagent.failed':
				await this.handleSubagentFailed(sessionId, event);
				break;
			default:
				break;
		}
	}

	private async handleToolExecutionStart(
		sessionId: string,
		webview: vscode.Webview,
		event: Extract<SessionEvent, { type: 'tool.execution_start' }>
	): Promise<void> {
		const toolName = event.data.toolName ?? 'unknown_tool';
		const parentToolCallId = event.data.parentToolCallId;
		const runId = parentToolCallId ? this.subagentRunIdsByParentToolCallId.get(parentToolCallId) : undefined;

		logAgentFlow('main.extension', 'callback:onToolStart', {
			sessionId,
			toolName,
			toolCallId: event.data.toolCallId,
			parentToolCallId,
			runId,
			activeSubagentRuns: this.activeSubagentRunIds.size
		});

		if (runId) {
			this.subagentRunIdsByToolCallId.set(event.data.toolCallId, runId);
			this.subagentToolNamesByToolCallId.set(event.data.toolCallId, toolName);
			this.sessionStore.setRunTransientToolStatus(sessionId, runId, `正在调用工具 \`${toolName}\`...`);
			await this.postRunStateToActiveWebview(sessionId, runId);
			return;
		}

		if (this.activeSubagentRunIds.size > 0) {
			return;
		}

		await webview.postMessage({
			type: 'chat:toolStatus',
			text: `正在调用工具 \`${toolName}\`...`,
			transient: true
		});
	}

	private async handleToolExecutionProgress(
		sessionId: string,
		event: Extract<SessionEvent, { type: 'tool.execution_progress' }>
	): Promise<void> {
		const runId = this.subagentRunIdsByToolCallId.get(event.data.toolCallId);
		if (!runId) {
			return;
		}
		this.sessionStore.appendRunProgress(sessionId, runId, event.data.progressMessage);
		await this.postRunStateToActiveWebview(sessionId, runId);
	}

	private async handleToolExecutionComplete(
		sessionId: string,
		webview: vscode.Webview,
		event: Extract<SessionEvent, { type: 'tool.execution_complete' }>
	): Promise<void> {
		const runId = this.subagentRunIdsByToolCallId.get(event.data.toolCallId);
		const toolName = this.subagentToolNamesByToolCallId.get(event.data.toolCallId);

		logAgentFlow('main.extension', 'callback:onToolEnd', {
			sessionId,
			toolCallId: event.data.toolCallId,
			toolName,
			runId,
			success: event.data.success,
			activeSubagentRuns: this.activeSubagentRunIds.size
		});

		if (runId) {
			if (toolName === 'update_progress') {
				const progressText = this.extractProgressFromToolResult(event);
				if (progressText) {
					this.sessionStore.appendRunProgress(sessionId, runId, progressText);
				}
			}
			this.subagentRunIdsByToolCallId.delete(event.data.toolCallId);
			this.subagentToolNamesByToolCallId.delete(event.data.toolCallId);
			this.sessionStore.clearRunTransientToolStatus(sessionId, runId);
			await this.postRunStateToActiveWebview(sessionId, runId);
			return;
		}

		this.subagentToolNamesByToolCallId.delete(event.data.toolCallId);

		if (this.activeSubagentRunIds.size > 0) {
			return;
		}

		await webview.postMessage({
			type: 'chat:toolStatusDone'
		});
	}

	private async handleSubagentStarted(
		sessionId: string,
		event: Extract<SessionEvent, { type: 'subagent.started' }>
	): Promise<void> {
		const existingRunId = this.subagentRunIdsByParentToolCallId.get(event.data.toolCallId);
		if (existingRunId) {
			logAgentFlow('main.extension.subagent', 'start:duplicate_ignored', {
				sessionId,
				runId: existingRunId,
				toolCallId: event.data.toolCallId,
				agentName: event.data.agentName
			});
			return;
		}

		const kind: ChatRun['kind'] = event.data.agentName === CODE_REVIEW_AGENT_NAME ? 'code_review' : 'subagent';
		const run = this.sessionStore.startRun(sessionId, {
			title: this.resolveSubagentDisplayName(event.data.agentName, event.data.agentDisplayName),
			kind
		});
		const shouldSuspendMainToolSlot = this.activeSubagentRunIds.size === 0;
		this.activeSubagentRunIds.add(run.id);
		this.subagentRunIdsByParentToolCallId.set(event.data.toolCallId, run.id);
		if (shouldSuspendMainToolSlot) {
			await this.setMainToolStatusSuspended(true);
		}
		logAgentFlow('main.extension.subagent', 'start', {
			sessionId,
			runId: run.id,
			toolCallId: event.data.toolCallId,
			agentName: event.data.agentName,
			agentDisplayName: event.data.agentDisplayName,
			activeSubagentRuns: this.activeSubagentRunIds.size
		});
		await this.postRunStateToActiveWebview(sessionId, run.id);
	}

	private async handleSubagentCompleted(
		sessionId: string,
		event: Extract<SessionEvent, { type: 'subagent.completed' }>
	): Promise<void> {
		const runId = this.subagentRunIdsByParentToolCallId.get(event.data.toolCallId);
		if (!runId) {
			return;
		}
		this.subagentRunIdsByParentToolCallId.delete(event.data.toolCallId);
		this.activeSubagentRunIds.delete(runId);
		if (this.activeSubagentRunIds.size === 0) {
			await this.setMainToolStatusSuspended(false);
		}
		const elapsedText = this.formatElapsedText(event.data.durationMs);
		const run = this.sessionStore.getRun(sessionId, runId);
		const finalAssistantText = run?.activeAssistantText.trim()
			? undefined
			: this.resolveSubagentCompletionText(event.data.agentName, event.data.agentDisplayName);
		logAgentFlow('main.extension.subagent', 'finish', {
			sessionId,
			runId,
			toolCallId: event.data.toolCallId,
			agentName: event.data.agentName,
			elapsedText,
			activeSubagentRuns: this.activeSubagentRunIds.size
		});
		this.sessionStore.finishRun(sessionId, runId, {
			elapsedText,
			finalAssistantText
		});
		await this.postRunStateToActiveWebview(sessionId, runId);
	}

	private async handleSubagentAssistantDelta(
		sessionId: string,
		parentToolCallId: string,
		text: string
	): Promise<void> {
		if (!text) {
			return;
		}

		const runId = this.subagentRunIdsByParentToolCallId.get(parentToolCallId);
		if (!runId) {
			logAgentFlow('main.extension.subagent', 'assistant_delta:run_missing', {
				sessionId,
				parentToolCallId,
				textLength: text.length,
				textPreview: summarizeText(text)
			});
			return;
		}

		logAgentFlow('main.extension.subagent', 'assistant_delta', {
			sessionId,
			runId,
			parentToolCallId,
			textLength: text.length,
			textPreview: summarizeText(text)
		});
		this.sessionStore.appendRunAssistantDelta(sessionId, runId, text);
		await this.postRunStateToActiveWebview(sessionId, runId);
	}

	private async handleSubagentFailed(
		sessionId: string,
		event: Extract<SessionEvent, { type: 'subagent.failed' }>
	): Promise<void> {
		const runId = this.subagentRunIdsByParentToolCallId.get(event.data.toolCallId);
		if (!runId) {
			return;
		}
		this.subagentRunIdsByParentToolCallId.delete(event.data.toolCallId);
		this.activeSubagentRunIds.delete(runId);
		if (this.activeSubagentRunIds.size === 0) {
			await this.setMainToolStatusSuspended(false);
		}
		const elapsedText = this.formatElapsedText(event.data.durationMs);
		logAgentFlow('main.extension.subagent', 'error', {
			sessionId,
			runId,
			toolCallId: event.data.toolCallId,
			agentName: event.data.agentName,
			message: event.data.error,
			elapsedText,
			activeSubagentRuns: this.activeSubagentRunIds.size
		});
		this.sessionStore.failRun(sessionId, runId, event.data.error, elapsedText);
		await this.postRunStateToActiveWebview(sessionId, runId);
	}

	private formatElapsedText(durationMs: number | undefined): string | undefined {
		if (!Number.isFinite(durationMs)) {
			return undefined;
		}
		return `用时：${((durationMs as number) / 1000).toFixed(2)}s`;
	}

	private resolveSubagentDisplayName(agentName: string | undefined, agentDisplayName: string | undefined): string {
		const explicitDisplayName = agentDisplayName?.trim();
		if (explicitDisplayName) {
			return explicitDisplayName;
		}

		switch (agentName) {
			case CODE_REVIEW_AGENT_NAME:
				return CODE_REVIEW_AGENT_DISPLAY_NAME;
			case PLANNING_AGENT_NAME:
				return PLANNING_AGENT_DISPLAY_NAME;
			case CODE_EXPLORATION_AGENT_NAME:
				return CODE_EXPLORATION_AGENT_DISPLAY_NAME;
			default:
				return 'Sub Agent';
		}
	}

	private resolveSubagentCompletionText(agentName: string | undefined, agentDisplayName: string | undefined): string {
		if (agentName === CODE_REVIEW_AGENT_NAME) {
			return '任务评估子 agent 已完成。';
		}

		return `${this.resolveSubagentDisplayName(agentName, agentDisplayName)} 已完成。`;
	}

	private extractProgressFromToolResult(
		event: Extract<SessionEvent, { type: 'tool.execution_complete' }>
	): string | undefined {
		const rawResult = (event.data as { result?: { content?: string; detailedContent?: string } }).result;
		const content = (rawResult?.detailedContent ?? rawResult?.content ?? '').trim();
		if (!content) {
			return undefined;
		}

		try {
			const parsed = JSON.parse(content) as { text?: string };
			const text = (parsed.text ?? '').trim();
			return text || undefined;
		} catch {
			return undefined;
		}
	}

	private async focusUserCodeRegion(sessionId: string, input: FocusCodeRegionInput): Promise<ChatFocusTarget> {
		const target = await this.resolveFocusTarget(sessionId, input);
		const targetIndex = this.upsertFocusTarget(sessionId, target);
		this.activeFocusIndexBySessionId.set(sessionId, targetIndex);
		await this.revealFocusView();
		await this.revealFocusTarget(sessionId, target);
		this.updateFocusSwitcherStatusBar();
		await this.postFocusTargetToActiveWebview(sessionId);
		await this.postFocusStateToActiveFocusWebview(sessionId);
		return target;
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
			title: (input.title ?? '').trim() || '下一步编码区域',
			instruction: (input.instruction ?? '').trim(),
			updatedAt: Date.now()
		};
	}

	private resolveTargetRange(
		document: vscode.TextDocument,
		input: FocusCodeRegionInput
	): vscode.Range {
		const lineCount = Math.max(1, document.lineCount);
		const startLineIndex = this.clampInteger(input.startLine, 1, 1, lineCount) - 1;
		const endLineIndex = this.clampInteger(input.endLine, startLineIndex + 1, startLineIndex + 1, lineCount) - 1;
		return new vscode.Range(startLineIndex, 0, endLineIndex, 0);
	}

	private ensureNonEmptyRange(document: vscode.TextDocument, range: vscode.Range): vscode.Range {
		if (!range.isEmpty) {
			return range;
		}
		const line = document.lineAt(range.start.line);
		return new vscode.Range(range.start, line.range.end);
	}

	private async revealFocusTarget(sessionId: string, target: ChatFocusTarget): Promise<void> {
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
		this.refreshFocusDecorationsForCurrentSession();
		this.updateFocusSwitcherStatusBar();
		if (this.sessionStore.getCurrentSessionId() === sessionId) {
			await this.postFocusTargetToActiveWebview(sessionId);
			await this.postFocusStateToActiveFocusWebview(sessionId);
		}
	}

	private clearFocusHighlight(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			editor.setDecorations(this.focusDecorationType, []);
		}
	}

	private refreshFocusDecorationsForCurrentSession(): void {
		const sessionId = this.sessionStore.getCurrentSessionId();
		const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		for (const editor of vscode.window.visibleTextEditors) {
			const ranges: vscode.Range[] = [];
			const editorPath = this.toWorkspaceRelativePath(editor.document.uri.fsPath);
			if (editorPath) {
				for (const target of targets) {
					if (target.path !== editorPath) {
						continue;
					}
					ranges.push(this.toDocumentRange(editor.document, target));
				}
			}
			editor.setDecorations(this.focusDecorationType, ranges);
		}
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
		const startLine = this.clampInteger(target.startLine, 1, 1, lineCount) - 1;
		const endLine = this.clampInteger(target.endLine, startLine + 1, startLine + 1, lineCount) - 1;
		return new vscode.Range(startLine, 0, endLine, 0);
	}

	private toSelectionRange(document: vscode.TextDocument, target: ChatFocusTarget): vscode.Range {
		const lineCount = Math.max(1, document.lineCount);
		const startLine = this.clampInteger(target.startLine, 1, 1, lineCount) - 1;
		const endLine = this.clampInteger(target.endLine, startLine + 1, startLine + 1, lineCount) - 1;
		const endCharacter = document.lineAt(endLine).range.end.character;
		return this.ensureNonEmptyRange(document, new vscode.Range(startLine, 0, endLine, endCharacter));
	}

	private async revealFocusView(): Promise<void> {
		await vscode.commands.executeCommand('workbench.action.openAuxiliaryBar').then(
			() => undefined,
			() => undefined
		);
		await vscode.commands
			.executeCommand(`${NaviSidebarViewProvider.focusViewType}.focus`)
			.then(() => undefined, () => undefined);
		await this.postFocusStateToActiveFocusWebview(this.sessionStore.getCurrentSessionId());
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
		const maxTargetsPerSession = 20;
		if (targets.length > maxTargetsPerSession) {
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

	private getActiveFocusTarget(sessionId: string): ChatFocusTarget | undefined {
		const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		if (targets.length === 0) {
			return undefined;
		}
		const index = this.getActiveFocusIndex(sessionId, targets.length);
		return targets[index];
	}

	private getActiveFocusIndex(sessionId: string, targetCount: number): number {
		if (targetCount <= 0) {
			return 0;
		}
		const stored = this.activeFocusIndexBySessionId.get(sessionId) ?? targetCount - 1;
		const normalized = this.clampInteger(stored, targetCount - 1, 0, targetCount - 1);
		this.activeFocusIndexBySessionId.set(sessionId, normalized);
		return normalized;
	}

	private async activateFocusTargetByIndex(sessionId: string, index: number, reveal: boolean): Promise<void> {
		const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		if (targets.length === 0) {
			return;
		}
		const normalizedIndex = this.clampInteger(index, targets.length - 1, 0, targets.length - 1);
		this.activeFocusIndexBySessionId.set(sessionId, normalizedIndex);
		const target = targets[normalizedIndex];
		if (reveal) {
			await this.revealFocusTarget(sessionId, target);
		}
		this.updateFocusSwitcherStatusBar();
		if (this.sessionStore.getCurrentSessionId() === sessionId) {
			await this.postFocusTargetToActiveWebview(sessionId);
		}
	}

	private updateFocusSwitcherStatusBar(): void {
		const sessionId = this.sessionStore.getCurrentSessionId();
		const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		if (targets.length === 0) {
			this.focusSwitcherStatusBar.text = '$(symbol-event) Navi Focus 0/0';
			this.focusSwitcherStatusBar.tooltip = '当前没有高亮区域，点击打开 Focus 面板';
			this.focusSwitcherStatusBar.show();
			this.focusPrevStatusBar.text = '$(chevron-left)';
			this.focusPrevStatusBar.tooltip = '当前没有高亮区域';
			this.focusPrevStatusBar.show();
			this.focusNextStatusBar.text = '$(chevron-right)';
			this.focusNextStatusBar.tooltip = '当前没有高亮区域';
			this.focusNextStatusBar.show();
			return;
		}

		const index = this.getActiveFocusIndex(sessionId, targets.length);
		const target = targets[index];
		this.focusSwitcherStatusBar.text = `$(symbol-event) Navi Focus ${index + 1}/${targets.length}`;
		this.focusSwitcherStatusBar.tooltip = `${target.path}:${target.startLine}-${target.endLine}\n点击切换目标区域`;
		this.focusSwitcherStatusBar.show();
		this.focusPrevStatusBar.text = '$(chevron-left)';
		this.focusPrevStatusBar.tooltip = '跳到上一个高亮区域';
		this.focusPrevStatusBar.show();
		this.focusNextStatusBar.text = '$(chevron-right)';
		this.focusNextStatusBar.tooltip = '跳到下一个高亮区域';
		this.focusNextStatusBar.show();
	}

	private async syncFocusTargetsForDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
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

		this.refreshFocusDecorationsForCurrentSession();
		this.updateFocusSwitcherStatusBar();
		const currentSessionId = this.sessionStore.getCurrentSessionId();
		await this.postFocusTargetToActiveWebview(currentSessionId);
		await this.postFocusStateToActiveFocusWebview(currentSessionId);
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

	private async cycleFocusTarget(delta: number): Promise<void> {
		const sessionId = this.sessionStore.getCurrentSessionId();
		const targets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		if (targets.length === 0) {
			void vscode.window.showInformationMessage('当前会话还没有可切换的高亮区域。');
			return;
		}

		const currentIndex = this.getActiveFocusIndex(sessionId, targets.length);
		const nextIndex = (currentIndex + delta + targets.length) % targets.length;
		await this.activateFocusTargetByIndex(sessionId, nextIndex, true);
	}

	private async clearFocusRegions(
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

				const filterStart = this.clampInteger(startLineFilter, target.startLine, 1, Number.MAX_SAFE_INTEGER);
				const filterEnd = this.clampInteger(endLineFilter, filterStart, filterStart, Number.MAX_SAFE_INTEGER);
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

		this.refreshFocusDecorationsForCurrentSession();
		this.updateFocusSwitcherStatusBar();
		if (this.sessionStore.getCurrentSessionId() === sessionId) {
			await this.postFocusTargetToActiveWebview(sessionId);
		}

		await this.postFocusStateToActiveFocusWebview(sessionId);
		return {
			removedCount,
			remainingCount: nextTargets.length,
			activeFocusTarget: this.getActiveFocusTarget(sessionId) ?? null
		};
	}

	private async getFocusRegions(
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

	private async jumpToFocus(
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

	private async submitFocusActionPrompt(
		sessionId: string,
		focusTargetIds: string[],
		action: FocusAction
	): Promise<void> {
		const webview = this.activeWebview;
		if (!webview) {
			void vscode.window.showWarningMessage('Chat 面板未打开，无法发送 Focus 操作请求。');
			return;
		}
		if (this.isGenerating) {
			await this.postError(webview, '请等待当前回答完成后再发起新的 Focus 操作。');
			return;
		}

		const allTargets = this.focusTargetsBySessionId.get(sessionId) ?? [];
		const selectedTargets = allTargets.filter((target) => focusTargetIds.includes(target.id));
		if (selectedTargets.length === 0) {
			void vscode.window.showInformationMessage('请先在 Focus 面板勾选至少一个高亮区域。');
			return;
		}

		const { preview, prompt } = buildFocusActionPrompt(selectedTargets, action);
		this.sessionStore.appendMessage(sessionId, 'user', preview);
		await webview.postMessage({
			type: 'chat:externalUserMessage',
			text: preview
		});
		await this.handleUserMessage(webview, prompt);
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

	private clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
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
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "navi" is now active!');

	const sidebarProvider = new NaviSidebarViewProvider(context.extensionUri, context.globalState);
	const viewProvider = vscode.window.registerWebviewViewProvider(
		NaviSidebarViewProvider.viewType,
		sidebarProvider
	);
	const focusViewProvider = vscode.window.registerWebviewViewProvider(
		NaviSidebarViewProvider.focusViewType,
		sidebarProvider
	);

	const newChatCommand = vscode.commands.registerCommand('navi.newChat', async () => {
		await sidebarProvider.createNewSession();
	});
	const disposable = vscode.commands.registerCommand('navi.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Navi!');
	});
	const focusSwitcherCommand = vscode.commands.registerCommand(NaviSidebarViewProvider.focusSwitcherCommand, async () => {
		await sidebarProvider.showFocusSwitcher();
	});
	const focusPrevCommand = vscode.commands.registerCommand(NaviSidebarViewProvider.focusPrevCommand, async () => {
		await sidebarProvider.focusPrevious();
	});
	const focusNextCommand = vscode.commands.registerCommand(NaviSidebarViewProvider.focusNextCommand, async () => {
		await sidebarProvider.focusNext();
	});

	context.subscriptions.push(newChatCommand);
	context.subscriptions.push(viewProvider);
	context.subscriptions.push(focusViewProvider);
	context.subscriptions.push(disposable);
	context.subscriptions.push(focusSwitcherCommand);
	context.subscriptions.push(focusPrevCommand);
	context.subscriptions.push(focusNextCommand);
	context.subscriptions.push({
		dispose: () => sidebarProvider.dispose()
	});
}

export function deactivate() {}
