import { createThreadId } from '../utils/id';
import type { ChatSession } from '../types/chat';

export class ChatSessionStore {
	private readonly sessions: ChatSession[] = [];
	private currentSessionId = '';

	constructor() {
		const firstSession = this.createSession();
		this.currentSessionId = firstSession.id;
	}

	public getSessions(): ChatSession[] {
		return this.sessions;
	}

	public getCurrentSessionId(): string {
		return this.currentSessionId;
	}

	public createSession(): ChatSession {
		const session: ChatSession = {
			id: createThreadId(),
			title: 'New Chat',
			createdAt: Date.now()
		};

		this.sessions.unshift(session);
		return session;
	}

	public switchSession(sessionId: string): boolean {
		if (!this.sessions.some((session) => session.id === sessionId)) {
			return false;
		}

		this.currentSessionId = sessionId;
		return true;
	}

	public updateSessionTitleIfNeeded(sessionId: string, prompt: string): void {
		const session = this.sessions.find((item) => item.id === sessionId);
		if (!session || session.title !== 'New Chat') {
			return;
		}

		const normalized = prompt.replace(/\s+/g, ' ').trim();
		session.title = normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
	}

	public renameSession(sessionId: string, nextTitle: string): boolean {
		const session = this.sessions.find((item) => item.id === sessionId);
		if (!session) {
			return false;
		}

		const normalized = nextTitle.replace(/\s+/g, ' ').trim();
		session.title = normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
		return true;
	}

	public deleteSession(sessionId: string): boolean {
		const index = this.sessions.findIndex((item) => item.id === sessionId);
		if (index < 0) {
			return false;
		}

		const deletingCurrent = this.currentSessionId === sessionId;
		this.sessions.splice(index, 1);

		if (this.sessions.length === 0) {
			const session = this.createSession();
			this.currentSessionId = session.id;
			return true;
		}

		if (deletingCurrent) {
			const nextIndex = Math.min(index, this.sessions.length - 1);
			this.currentSessionId = this.sessions[nextIndex].id;
		}

		return true;
	}
}
