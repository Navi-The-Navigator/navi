import * as vscode from 'vscode';
import type {
	ChatFocusTarget,
	ChatRun,
	ChatSession,
	ChatSessionViewState,
	ChatTodo
} from '../types/chat';

/**
 * Source of the currently-resolved chat webview. The chat view provider owns the
 * webview lifetime; the messenger reads it lazily so it keeps working across
 * webview disposal/recreation.
 */
export interface ChatWebviewSource {
	getActiveWebview(): vscode.Webview | undefined;
}

/**
 * Sole owner of every outbound `chat:*` message to the chat webview. Centralizes
 * the wire protocol so callers never touch `webview.postMessage` directly.
 */
export class ChatMessenger {
	constructor(private readonly source: ChatWebviewSource) {}

	public hasActiveWebview(): boolean {
		return !!this.source.getActiveWebview();
	}

	private async post(message: Record<string, unknown>): Promise<void> {
		try {
			await this.source.getActiveWebview()?.postMessage(message);
		} catch {
			// The webview may have been disposed between read and post; ignore.
		}
	}

	public async postAssistantStart(): Promise<void> {
		await this.post({ type: 'chat:assistantStart' });
	}

	public async postAssistantDelta(text: string): Promise<void> {
		await this.post({ type: 'chat:assistantDelta', text });
	}

	public async postAssistantDone(): Promise<void> {
		await this.post({ type: 'chat:assistantDone' });
	}

	public async postElapsed(text: string): Promise<void> {
		await this.post({ type: 'chat:elapsed', text });
	}

	public async postError(text: string): Promise<void> {
		await this.post({ type: 'chat:error', text });
	}

	public async postToolStatus(text: string, transient: boolean): Promise<void> {
		await this.post({ type: 'chat:toolStatus', text, transient });
	}

	public async postToolStatusDone(): Promise<void> {
		await this.post({ type: 'chat:toolStatusDone' });
	}

	public async postToolStatusSuspended(suppressed: boolean): Promise<void> {
		await this.post({ type: suppressed ? 'chat:toolStatusSuspend' : 'chat:toolStatusResume' });
	}

	public async postSessions(sessions: ChatSession[], currentSessionId: string): Promise<void> {
		await this.post({ type: 'chat:sessions', sessions, currentSessionId });
	}

	public async postSessionState(sessionId: string, state: ChatSessionViewState): Promise<void> {
		await this.post({ type: 'chat:sessionState', sessionId, state });
	}

	public async postRunState(sessionId: string, run: ChatRun): Promise<void> {
		await this.post({ type: 'chat:runState', sessionId, run });
	}

	public async postTodos(sessionId: string, todos: ChatTodo[]): Promise<void> {
		await this.post({ type: 'chat:todos', sessionId, todos });
	}

	public async postFocusTarget(sessionId: string, focusTarget: ChatFocusTarget | null): Promise<void> {
		await this.post({ type: 'chat:focusTarget', sessionId, focusTarget });
	}

	public async postExternalUserMessage(text: string): Promise<void> {
		await this.post({ type: 'chat:externalUserMessage', text });
	}
}
