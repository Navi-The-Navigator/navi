import * as vscode from 'vscode';
import type { ChatInboundMessage } from '../types/chat';
import type { ChatInboundRouter } from './inboundRouter.js';

/**
 * Webview view provider for the chat panel. Owns the active chat webview handle
 * (read by the messenger) and forwards inbound messages to the router.
 */
export class NaviChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'navi.chatWebview';

	public activeWebview?: vscode.Webview;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly getChatHtml: (webview: vscode.Webview, extensionUri: vscode.Uri) => string,
		private readonly router: ChatInboundRouter
	) {}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.activeWebview = webviewView.webview;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};
		webviewView.webview.html = this.getChatHtml(webviewView.webview, this.extensionUri);
		webviewView.webview.onDidReceiveMessage(async (message: ChatInboundMessage) => {
			await this.router.handle(message);
		});
	}
}
