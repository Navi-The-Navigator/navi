import type { CopilotClient, CopilotSession, CustomAgentConfig } from '@github/copilot-sdk';
import { logAgentFlow } from './debugLogger.js';
import type { CopilotClientManager } from './copilotClient.js';
import { buildSessionConfig } from './sessionConfig.js';
import type { NaviTool } from './naviTool';

/**
 * Owns per-thread {@link CopilotSession} lifecycle: create/resume/dispose, the
 * session map, the resumable-id set, and the "has this thread spoken before"
 * heuristic. Extracted from the former chatGateway; replaces the old in-memory
 * `messageHistory` map (the session store is the sole rendered-history owner,
 * and the SDK owns server-side conversation state).
 */
export class SessionManager {
	private sessionMap = new Map<string, CopilotSession>();
	private readonly resumableSessionIds = new Set<string>();
	private readonly startedSessionIds = new Set<string>();

	constructor(
		private readonly clientManager: CopilotClientManager,
		private readonly tools: NaviTool[],
		private readonly customAgents?: CustomAgentConfig[]
	) {}

	/** Record that a thread has been spoken to (drives the resume heuristic). */
	public markStarted(sessionId: string): void {
		this.startedSessionIds.add(sessionId);
	}

	public async getOrCreateSession(sessionId: string): Promise<CopilotSession> {
		const existing = this.sessionMap.get(sessionId);
		if (existing) {
			return existing;
		}

		const client = await this.clientManager.getOrCreateClient();
		const sessionConfig = buildSessionConfig(this.tools, this.customAgents);
		const shouldResume = this.resumableSessionIds.has(sessionId) || this.startedSessionIds.has(sessionId);
		let session: CopilotSession | undefined;

		if (shouldResume) {
			try {
				session = await client.resumeSession(sessionId, sessionConfig);
				logAgentFlow('main.gateway', 'resumeSession:resumed', {
					sessionId,
					toolCount: this.tools.length,
					customAgentCount: (this.customAgents ?? []).length
				});
			} catch (error) {
				logAgentFlow('main.gateway', 'resumeSession:failed_fallback_to_create', {
					sessionId,
					error
				});
			}
		}

		if (!session) {
			const createConfig: Parameters<CopilotClient['createSession']>[0] = {
				sessionId,
				...sessionConfig
			};
			session = await client.createSession(createConfig);
			logAgentFlow('main.gateway', 'createSession:created', {
				sessionId,
				toolCount: this.tools.length,
				customAgentCount: (this.customAgents ?? []).length,
				resumedFallback: shouldResume
			});
		}

		this.resumableSessionIds.delete(sessionId);
		this.sessionMap.set(sessionId, session);
		return session;
	}

	public async resetForRetry(sessionId: string): Promise<void> {
		await this.disposeSession(sessionId, true);
	}

	public async disposeSession(sessionId: string, resumable: boolean): Promise<void> {
		const session = this.sessionMap.get(sessionId);
		this.sessionMap.delete(sessionId);
		if (resumable) {
			this.resumableSessionIds.add(sessionId);
		} else {
			this.resumableSessionIds.delete(sessionId);
		}

		if (!session) {
			return;
		}

		try {
			await session.disconnect();
		} catch (error) {
			logAgentFlow('main.gateway', 'disposeSession:disconnect_failed', {
				sessionId,
				resumable,
				error
			});
		}
	}

	/** Dispose every tracked session. When not resumable, also clears the resumable set. */
	public async disposeAll(resumable: boolean): Promise<void> {
		for (const sessionId of [...this.sessionMap.keys()]) {
			await this.disposeSession(sessionId, resumable);
		}
		if (!resumable) {
			this.resumableSessionIds.clear();
		}
	}

	/**
	 * Detach a session from tracking for cancellation: synchronously remove it
	 * from the map and mark it resumable, then (asynchronously) optionally abort
	 * and disconnect it.
	 */
	public beginCancellation(session: CopilotSession, requestAbort: boolean): Promise<void> {
		const mappedSession = this.sessionMap.get(session.sessionId);
		if (mappedSession === session) {
			this.sessionMap.delete(session.sessionId);
		}
		this.resumableSessionIds.add(session.sessionId);

		return (async () => {
			if (requestAbort) {
				try {
					await session.abort();
				} catch (error) {
					logAgentFlow('main.gateway', 'waitForIdle:abort_request_failed', {
						sessionId: session.sessionId,
						error
					});
				}
			}

			try {
				await session.disconnect();
			} catch (error) {
				logAgentFlow('main.gateway', 'waitForIdle:disconnect_after_abort_failed', {
					sessionId: session.sessionId,
					error
				});
			}
		})();
	}
}
