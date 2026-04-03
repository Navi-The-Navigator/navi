import * as vscode from 'vscode';
import * as path from 'path';
import { DeepSeekChatGateway } from './agent/chatGateway';
import {
	createClearFocusCodeRegionTool,
	type ClearFocusCodeRegionInput
} from './agent/tools/clearFocusCodeRegionTool';
import { createDateTimeTool } from './agent/tools/dateTimeTool';
import { createFocusCodeRegionTool, type FocusCodeRegionInput } from './agent/tools/focusCodeRegionTool';
import {
	createGetFocusCodeRegionsTool,
	type GetFocusCodeRegionsInput
} from './agent/tools/getFocusCodeRegionsTool';
import { createGetWorkspaceErrorsTool } from './agent/tools/getWorkspaceErrorsTool';
import { createCodeReviewTool } from './agent/agents/codeReviewAgentTool';
import type {
	SubagentTraceCallbacks,
	SubagentTraceErrorPayload,
	SubagentTraceFinishPayload,
	SubagentTraceStartInput
} from './agent/subagentTrace';
import { createManageTodosTool } from './agent/tools/manageTodosTool';
import { createProjectStructureTool } from './agent/tools/projectStructureTool';
import { createReadFileTool } from './agent/tools/readFileTool';
import { createSearchFileContentTool } from './agent/tools/searchFileContentTool';
import { createSearchFilesTool } from './agent/tools/searchFilesTool';
import { createUpdateProgressTool } from './agent/tools/updateProgressTool';
import { ChatSessionStore } from './chat/sessionStore';
import { SettingsManager } from './settings/settingsManager';
import type { ChatFocusTarget, ChatInboundMessage, ChatRun } from './types/chat';
import { createFocusTargetId } from './utils/id';
import { getFocusHtml } from './webview/focusHtml';
import { getSidebarHtml } from './webview/sidebarHtml';

class NaviSidebarViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'navi.sidebarWebview';
	public static readonly focusViewType = 'navi.focusWebview';
	private static readonly envApiKeyConfirmedStateKey = 'navi.confirmedEnvApiKey';
	public static readonly focusSwitcherCommand = 'navi.focusSwitcher';
	public static readonly focusPrevCommand = 'navi.focusPrev';
	public static readonly focusNextCommand = 'navi.focusNext';

	private readonly sessionStore = new ChatSessionStore();
	private readonly gateway: DeepSeekChatGateway;
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
	private activeWebview?: vscode.Webview;
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

		this.gateway = new DeepSeekChatGateway([
			createDateTimeTool(),
			createProjectStructureTool(),
			createReadFileTool(),
			createSearchFilesTool(),
			createSearchFileContentTool(),
			createGetWorkspaceErrorsTool(),
			createCodeReviewTool(undefined, undefined, this.createSubagentTraceCallbacks({
				fallbackTitle: 'Task Assessment Agent',
				kind: 'code_review',
				cancelledFinalText: '已取消本次子任务。'
			})),
			createFocusCodeRegionTool({
				getCurrentSessionId: () => this.sessionStore.getCurrentSessionId(),
				focusRegion: async (sessionId, input) => this.focusUserCodeRegion(sessionId, input)
			}),
			createClearFocusCodeRegionTool({
				getCurrentSessionId: () => this.sessionStore.getCurrentSessionId(),
				clearFocusRegions: async (sessionId, input) => this.clearFocusRegions(sessionId, input)
			}),
			createGetFocusCodeRegionsTool({
				getCurrentSessionId: () => this.sessionStore.getCurrentSessionId(),
				getFocusRegions: async (sessionId, input) => this.getFocusRegions(sessionId, input)
			}),
			createUpdateProgressTool({
				onProgress: async (text) => {
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
			}),
			createManageTodosTool({
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
				}
			})
		]);
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
		const sessionId = this.sessionStore.getCurrentSessionId();
		this.activeGenerationSessionId = sessionId;
		this.sessionStore.startAssistantReply(sessionId);
		await webview.postMessage({ type: 'chat:assistantStart' });

		try {
			this.sessionStore.updateSessionTitleIfNeeded(sessionId, prompt);
			await this.postSessionSummary(webview);

			const assistantText = await this.gateway.streamAssistantReply(sessionId, prompt, {
				onToolStart: async (toolName) => {
					if (this.activeSubagentRunIds.size > 0) {
						return;
					}
					if (toolName === 'code_review_agent') {
						return;
					}
					await webview.postMessage({
						type: 'chat:toolStatus',
						text: `正在调用工具 \`${toolName}\`...`,
						transient: true
					});
				},
				onToolEnd: async () => {
					if (this.activeSubagentRunIds.size > 0) {
						return;
					}
					if (!this.activeWebview) {
						return;
					}
					await webview.postMessage({
						type: 'chat:toolStatusDone'
					});
				},
				onAssistantDelta: async (delta) => {
					if (this.activeSubagentRunIds.size > 0) {
						return;
					}
					this.sessionStore.appendAssistantDelta(sessionId, delta);
					await webview.postMessage({
						type: 'chat:assistantDelta',
						text: delta
					});
				},
				shouldCancel: () => this.cancelGenerationRequested,
				abortSignal: generationAbortController.signal
			});

			if (!assistantText.trim()) {
				this.sessionStore.appendAssistantDelta(sessionId, '我暂时没有生成可显示的文本响应。');
				await webview.postMessage({
					type: 'chat:assistantDelta',
					text: '我暂时没有生成可显示的文本响应。'
				});
			}

			const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(2);
			elapsedText = `用时：${elapsedSeconds}s`;
			shouldPersistElapsed = true;
			await webview.postMessage({
				type: 'chat:elapsed',
				text: elapsedText
			});
		} catch (error) {
			const messageText = error instanceof Error ? error.message : 'Unknown error';
			if (messageText.includes('用户已取消')) {
				this.sessionStore.setAssistantError(sessionId, '已取消本次回复。');
				await webview.postMessage({
					type: 'chat:assistantDelta',
					text: '已取消本次回复。'
				});
				return;
			}
			this.sessionStore.setAssistantError(sessionId, `请求 DeepSeek 失败：${messageText}`);
			await this.postError(webview, `请求 DeepSeek 失败：${messageText}`);
		} finally {
			this.sessionStore.finishAssistantReply(sessionId);
			if (shouldPersistElapsed && elapsedText) {
				this.sessionStore.appendStatusEntry(sessionId, 'elapsed', elapsedText);
			}
			this.activeSubagentRunIds.clear();
			await this.setMainToolStatusSuspended(false);
			this.isGenerating = false;
			this.cancelGenerationRequested = false;
			this.activeGenerationSessionId = undefined;
			if (this.activeGenerationAbortController === generationAbortController) {
				this.activeGenerationAbortController = undefined;
			}
			await webview.postMessage({ type: 'chat:assistantDone' });
		}
	}

	private async ensureApiKeyBeforeFirstMessage(): Promise<boolean> {
		const config = vscode.workspace.getConfiguration('navi');
		const configuredApiKey = (config.get<string>('deepseekApiKey') ?? '').trim();
		if (configuredApiKey) {
			return true;
		}

		const envApiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
		if (envApiKey) {
			const hasConfirmedEnvApiKey = this.globalState.get<boolean>(
				NaviSidebarViewProvider.envApiKeyConfirmedStateKey,
				false
			);
			if (hasConfirmedEnvApiKey) {
				return true;
			}

			const choice = await vscode.window.showInformationMessage(
				'检测到环境变量 DEEPSEEK_API_KEY。当前未在 VS Code 中配置 API Key。是否先使用环境变量继续？',
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
				const refreshedApiKey = (config.get<string>('deepseekApiKey') ?? '').trim();
				if (refreshedApiKey) {
					return true;
				}
				return false;
			}

			return false;
		}

		const setupChoice = await vscode.window.showWarningMessage(
			'还没有可用的 API Key。是否现在去设置？',
			{ modal: true },
			'去设置 Key'
		);
		if (setupChoice !== '去设置 Key') {
			return false;
		}

		await this.settingsManager.openApiKeySettings();
		const updatedApiKey = (config.get<string>('deepseekApiKey') ?? '').trim();
		return !!updatedApiKey;
	}

	private async postError(webview: vscode.Webview, text: string): Promise<void> {
		await webview.postMessage({
			type: 'chat:error',
			text
		});
	}

	private didAffectChatModelConfiguration(event: vscode.ConfigurationChangeEvent): boolean {
		return (
			event.affectsConfiguration('navi.deepseekApiKey') ||
			event.affectsConfiguration('navi.deepseekBaseUrl') ||
			event.affectsConfiguration('navi.deepseekModel') ||
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

	private createSubagentTraceCallbacks(input: {
		fallbackTitle: string;
		kind: ChatRun['kind'];
		cancelledFinalText?: string;
		autoCollapse?: boolean;
	}): SubagentTraceCallbacks {
		return {
			start: async (startInput: SubagentTraceStartInput) => {
				const sessionId = this.activeGenerationSessionId;
				if (!sessionId) {
					return undefined;
				}
				const run = this.sessionStore.startRun(sessionId, {
					title: startInput.title || input.fallbackTitle,
					kind: startInput.kind || input.kind,
					parentRunId: startInput.parentRunId,
					autoCollapse: input.autoCollapse
				});
				const shouldSuspendMainToolSlot = this.activeSubagentRunIds.size === 0;
				this.activeSubagentRunIds.add(run.id);
				if (shouldSuspendMainToolSlot) {
					await this.setMainToolStatusSuspended(true);
				}
				await this.postRunStateToActiveWebview(sessionId, run.id);
				return run.id;
			},
			onProgress: async (runId, text) => {
				const sessionId = this.activeGenerationSessionId;
				if (!sessionId) {
					return;
				}
				this.sessionStore.appendRunProgress(sessionId, runId, text);
				await this.postRunStateToActiveWebview(sessionId, runId);
			},
			onToolStart: async (runId, toolName) => {
				const sessionId = this.activeGenerationSessionId;
				if (!sessionId) {
					return;
				}
				this.sessionStore.setRunTransientToolStatus(sessionId, runId, `正在调用工具 \`${toolName}\`...`);
				await this.postRunStateToActiveWebview(sessionId, runId);
			},
			onToolEnd: async (runId, toolName) => {
				const sessionId = this.activeGenerationSessionId;
				if (!sessionId) {
					return;
				}
				this.sessionStore.clearRunTransientToolStatus(sessionId, runId);
				await this.postRunStateToActiveWebview(sessionId, runId);
			},
			onAssistantDelta: async (runId, delta) => {
				const sessionId = this.activeGenerationSessionId;
				if (!sessionId) {
					return;
				}
				this.sessionStore.appendRunAssistantDelta(sessionId, runId, delta);
				await this.postRunStateToActiveWebview(sessionId, runId);
			},
			onFinish: async (runId, payload: SubagentTraceFinishPayload) => {
				const sessionId = this.activeGenerationSessionId;
				if (!sessionId) {
					return;
				}
				this.activeSubagentRunIds.delete(runId);
				if (this.activeSubagentRunIds.size === 0) {
					await this.setMainToolStatusSuspended(false);
				}
				this.sessionStore.finishRun(sessionId, runId, {
					elapsedText: payload.elapsedText,
					finalAssistantText: payload.finalText
				});
				await this.postRunStateToActiveWebview(sessionId, runId);
			},
			onError: async (runId, payload: SubagentTraceErrorPayload) => {
				const sessionId = this.activeGenerationSessionId;
				if (!sessionId) {
					return;
				}
				this.activeSubagentRunIds.delete(runId);
				if (this.activeSubagentRunIds.size === 0) {
					await this.setMainToolStatusSuspended(false);
				}
				if (payload.message.includes('用户已取消')) {
					this.sessionStore.finishRun(sessionId, runId, {
						status: 'cancelled',
						elapsedText: payload.elapsedText,
						finalAssistantText: input.cancelledFinalText || '已取消本次子任务。'
					});
				} else {
					this.sessionStore.failRun(sessionId, runId, payload.message, payload.elapsedText);
				}
				await this.postRunStateToActiveWebview(sessionId, runId);
			},
			getAbortSignal: () => this.activeGenerationAbortController?.signal
		};
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

	private async submitFocusActionPrompt(
		sessionId: string,
		focusTargetIds: string[],
		action: 'review' | 'help'
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

		const { preview, prompt } = this.buildFocusActionPrompt(selectedTargets, action);
		this.sessionStore.appendMessage(sessionId, 'user', preview);
		await webview.postMessage({
			type: 'chat:externalUserMessage',
			text: preview
		});
		await this.handleUserMessage(webview, prompt);
	}

	private buildFocusActionPrompt(
		targets: ChatFocusTarget[],
		action: 'review' | 'help'
	): { preview: string; prompt: string } {
		const regionLines = targets
			.map(
				(target, index) =>
					`${index + 1}. [${target.id}] ${target.path}:${target.startLine}-${target.endLine}\n标题: ${target.title}\n说明: ${target.instruction || '无'}`
			)
			.join('\n\n');

		if (action === 'review') {
			return {
				preview: `请 Review 我选中的 ${targets.length} 个 Focus 区域。`,
				prompt:
					'请针对我选中的 focus 区域进行 Review，分析我的任务完成情况、潜在问题，以及最合理的下一步。\n\n选中的区域如下：\n' +
					regionLines
			};
		}

		if (action === 'help') {
			return {
				preview: `请 Help 我处理选中的 ${targets.length} 个 Focus 区域。`,
				prompt:
					'请帮助我处理下面选中的 focus 区域。解释这些区域各自要改什么、推荐的落笔顺序、关键判断条件和容易出错的地方。\n\n选中的区域如下：\n' +
					regionLines
			};
		}

		return {
			preview: `请 Review 我选中的 ${targets.length} 个 Focus 区域。`,
			prompt:
				'请针对我选中的 focus 区域进行 Review，分析我的任务完成情况、潜在问题，以及最合理的下一步。\n\n选中的区域如下：\n' +
				regionLines
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
