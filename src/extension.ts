import * as vscode from 'vscode';
import { DeepSeekChatGateway } from './agent/chatGateway';
import { createDateTimeTool } from './agent/tools/dateTimeTool';
import { ChatSessionStore } from './chat/sessionStore';
import type { ChatInboundMessage } from './types/chat';
import { getSidebarHtml } from './webview/sidebarHtml';

class NaviSidebarViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'navi.sidebarWebview';

	private readonly gateway = new DeepSeekChatGateway([createDateTimeTool()]);
	private readonly sessionStore = new ChatSessionStore();
	private isGenerating = false;

	constructor(private readonly extensionUri: vscode.Uri) {}

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

	const viewProvider = vscode.window.registerWebviewViewProvider(
		NaviSidebarViewProvider.viewType,
		new NaviSidebarViewProvider(context.extensionUri)
	);

	const disposable = vscode.commands.registerCommand('navi.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Navi!');
	});

	context.subscriptions.push(viewProvider);
	context.subscriptions.push(disposable);
}

export function deactivate() {}
