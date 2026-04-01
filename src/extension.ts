import * as vscode from 'vscode';
import { DeepSeekChatGateway } from './agent/chatGateway';
import { createDateTimeTool } from './agent/tools/dateTimeTool';
import { ChatSessionStore } from './chat/sessionStore';
import { SettingsManager } from './settings/settingsManager';
import type { ChatInboundMessage } from './types/chat';
import { getSidebarHtml } from './webview/sidebarHtml';

class NaviSidebarViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'navi.sidebarWebview';
	private static readonly envApiKeyConfirmedStateKey = 'navi.confirmedEnvApiKey';

	private readonly gateway = new DeepSeekChatGateway([createDateTimeTool()]);
	private readonly sessionStore = new ChatSessionStore();
	private readonly settingsManager = new SettingsManager();
	private isGenerating = false;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly globalState: vscode.Memento
	) {}

	public dispose(): void {
		void this.gateway.dispose();
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		webviewView.webview.html = getSidebarHtml(webviewView.webview, this.extensionUri);
		webviewView.webview.onDidReceiveMessage(async (message: ChatInboundMessage) => {
			await this.handleInboundMessage(webviewView.webview, message);
		});
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

			await this.syncSessionsToWebview(webview);
			return;
		}

		if (message.type === 'chat:openSettings') {
			await this.settingsManager.openSettings();
			return;
		}

		if (message.type !== 'chat:userMessage') {
			return;
		}

		const prompt = (message.text ?? '').trim();
		if (!prompt) {
			return;
		}

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
		const startedAt = Date.now();
		await webview.postMessage({ type: 'chat:assistantStart' });

		try {
			const sessionId = this.sessionStore.getCurrentSessionId();
			this.sessionStore.updateSessionTitleIfNeeded(sessionId, prompt);
			await this.postSessionSummary(webview);

			const assistantText = await this.gateway.streamAssistantReply(sessionId, prompt, {
				onToolStart: async (toolName) => {
					await webview.postMessage({
						type: 'chat:toolStatus',
						text: `正在调用工具 \`${toolName}\`...`
					});
				},
				onAssistantDelta: async (delta) => {
					await webview.postMessage({
						type: 'chat:assistantDelta',
						text: delta
					});
				}
			});

			if (!assistantText.trim()) {
				await webview.postMessage({
					type: 'chat:assistantDelta',
					text: '我暂时没有生成可显示的文本响应。'
				});
			}

			const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(2);
			await webview.postMessage({
				type: 'chat:elapsed',
				text: `用时：${elapsedSeconds}s`
			});
		} catch (error) {
			const messageText = error instanceof Error ? error.message : 'Unknown error';
			await this.postError(webview, `请求 DeepSeek 失败：${messageText}`);
		} finally {
			this.isGenerating = false;
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

	private async postSessionSummary(webview: vscode.Webview): Promise<void> {
		await webview.postMessage({
			type: 'chat:sessions',
			sessions: this.sessionStore.getSessions(),
			currentSessionId: this.sessionStore.getCurrentSessionId()
		});
	}

	private async syncSessionsToWebview(webview: vscode.Webview): Promise<void> {
		const currentSessionId = this.sessionStore.getCurrentSessionId();
		await this.postSessionSummary(webview);
		const messages = await this.gateway.loadSessionMessages(currentSessionId);
		await webview.postMessage({
			type: 'chat:sessionHistory',
			sessionId: currentSessionId,
			messages
		});
	}
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "navi" is now active!');

	const sidebarProvider = new NaviSidebarViewProvider(context.extensionUri, context.globalState);
	const viewProvider = vscode.window.registerWebviewViewProvider(
		NaviSidebarViewProvider.viewType,
		sidebarProvider
	);

	const disposable = vscode.commands.registerCommand('navi.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Navi!');
	});

	context.subscriptions.push(viewProvider);
	context.subscriptions.push(disposable);
	context.subscriptions.push({
		dispose: () => sidebarProvider.dispose()
	});
}

export function deactivate() {}
