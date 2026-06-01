import * as vscode from 'vscode';
import { ChatMessenger } from './chat/chatMessenger.js';
import { NaviChatViewProvider } from './chat/chatViewProvider.js';
import { GenerationController } from './chat/generationController.js';
import { ChatInboundRouter } from './chat/inboundRouter.js';
import { ChatSessionStore } from './chat/sessionStore.js';
import { SubagentRunTracker } from './chat/subagentRunTracker.js';
import { FocusController } from './focus/focusController.js';
import { FocusDecorations } from './focus/focusDecorations.js';
import { FocusStatusBar } from './focus/focusStatusBar.js';
import { NaviFocusViewProvider } from './focus/focusViewProvider.js';
import { SettingsManager } from './settings/settingsManager.js';
import { getChatHtml } from './webview/chat/html.js';
import { getFocusHtml } from './webview/focus/html.js';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "navi" is now active!');

	const sessionStore = new ChatSessionStore();
	const settingsManager = new SettingsManager();
	const focusDecorations = new FocusDecorations();
	const focusStatusBar = new FocusStatusBar();

	// Forward references: the messenger reads the chat webview and the focus
	// controller/router push to the focus webview; both providers are created
	// after their collaborators, so these closures defer the lookup until a
	// message actually fires.
	let chatProvider: NaviChatViewProvider;
	let focusProvider: NaviFocusViewProvider;

	const messenger = new ChatMessenger({ getActiveWebview: () => chatProvider.activeWebview });
	const tracker = new SubagentRunTracker(sessionStore, messenger);
	const focusController = new FocusController(
		sessionStore,
		focusDecorations,
		focusStatusBar,
		messenger,
		(sessionId) => focusProvider.postFocusState(sessionId)
	);
	const generationController = new GenerationController(
		sessionStore,
		messenger,
		tracker,
		focusController,
		settingsManager,
		context.globalState
	);
	const router = new ChatInboundRouter(
		sessionStore,
		focusController,
		generationController,
		messenger,
		settingsManager,
		(sessionId) => focusProvider.postFocusState(sessionId)
	);

	chatProvider = new NaviChatViewProvider(context.extensionUri, getChatHtml, router);
	focusProvider = new NaviFocusViewProvider(
		context.extensionUri,
		getFocusHtml,
		sessionStore,
		focusController,
		generationController,
		messenger
	);

	focusController.updateStatusBar();

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(NaviChatViewProvider.viewType, chatProvider),
		vscode.window.registerWebviewViewProvider(NaviFocusViewProvider.viewType, focusProvider),
		vscode.commands.registerCommand('navi.newChat', () => router.createNewSession()),
		vscode.commands.registerCommand('navi.helloWorld', () => {
			vscode.window.showInformationMessage('Hello World from Navi!');
		}),
		vscode.commands.registerCommand(FocusStatusBar.focusSwitcherCommand, () => focusController.revealFocusView()),
		vscode.commands.registerCommand(FocusStatusBar.focusPrevCommand, () => focusController.focusPrevious()),
		vscode.commands.registerCommand(FocusStatusBar.focusNextCommand, () => focusController.focusNext()),
		vscode.window.onDidChangeVisibleTextEditors(() => focusController.refreshDecorations()),
		vscode.window.onDidChangeActiveTextEditor(() => {
			focusController.refreshDecorations();
			focusController.updateStatusBar();
		}),
		vscode.workspace.onDidChangeConfiguration((event) => generationController.handleConfigurationChange(event)),
		vscode.workspace.onDidChangeTextDocument((event) => focusController.syncFocusTargetsForDocumentChange(event)),
		focusDecorations,
		focusStatusBar,
		generationController
	);
}

export function deactivate() {}
