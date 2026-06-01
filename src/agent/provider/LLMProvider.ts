import type { TurnCallbacks } from '../turnRunner.js';

/**
 * The swappable model port. The chat gateway depends only on this interface, so
 * a different backend (or a test fake) can be substituted without touching the
 * chat/agent layers. The Copilot CLI implementation lives in
 * {@link ./CopilotProvider.ts}; SDK value-imports are confined to it (+ modelFactory).
 */
export interface LLMProvider {
	/**
	 * Run one turn for a thread and resolve when the session is idle. Top-level
	 * (non-sub-agent) assistant text is streamed to {@link onMainText} so the
	 * caller can accumulate the reply (and consult it for retry decisions).
	 */
	runTurn(
		threadId: string,
		prompt: string,
		callbacks: TurnCallbacks,
		onMainText: (delta: string) => void
	): Promise<void>;

	/** Drop the thread's session so the next runTurn recreates/resumes it (transport retry). */
	resetForRetry(threadId: string): Promise<void>;

	/** Tear down all sessions and stop the backend. */
	dispose(): Promise<void>;

	/** Tear down all sessions, stop the backend, and clear init state (settings changed). */
	invalidate(): Promise<void>;
}
