import type { CustomAgentConfig } from '@github/copilot-sdk';
import { CopilotClientManager } from '../copilotClient.js';
import { logAgentFlow } from '../debugLogger.js';
import type { NaviTool } from '../naviTool';
import { SessionManager } from '../sessionManager.js';
import { runTurn, type TurnCallbacks } from '../turnRunner.js';
import type { LLMProvider } from './LLMProvider.js';

/**
 * {@link LLMProvider} backed by the GitHub Copilot CLI (via @github/copilot-sdk).
 * Composes the client manager, session manager, and turn runner. The only
 * SDK-aware provider today.
 */
export class CopilotProvider implements LLMProvider {
	private readonly clientManager = new CopilotClientManager();
	private readonly sessions: SessionManager;

	constructor(tools: NaviTool[], customAgents?: CustomAgentConfig[]) {
		this.sessions = new SessionManager(this.clientManager, tools, customAgents);
	}

	public async runTurn(
		threadId: string,
		prompt: string,
		callbacks: TurnCallbacks,
		onMainText: (delta: string) => void
	): Promise<void> {
		const session = await this.sessions.getOrCreateSession(threadId);
		logAgentFlow('main.gateway', 'streamAssistantReply:session_ready', { sessionId: threadId });

		this.sessions.markStarted(threadId);

		const turnPromise = runTurn(
			session,
			{
				beginCancellation: (target, requestAbort) => this.sessions.beginCancellation(target, requestAbort),
				onMainText
			},
			callbacks
		);

		logAgentFlow('main.gateway', 'streamAssistantReply:send_prompt', { sessionId: threadId });
		await session.send({ prompt });
		await turnPromise;
	}

	public async resetForRetry(threadId: string): Promise<void> {
		await this.sessions.resetForRetry(threadId);
	}

	public async dispose(): Promise<void> {
		await this.sessions.disposeAll(false);
		await this.clientManager.stop(false);
	}

	public async invalidate(): Promise<void> {
		await this.sessions.disposeAll(true);
		await this.clientManager.stop(true);
	}
}
