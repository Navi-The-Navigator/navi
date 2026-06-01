import type { CopilotSession, SessionEvent } from '@github/copilot-sdk';
import { logAgentFlow, summarizeText } from './debugLogger.js';
import { type AgentEvent, logSessionEvent, toAgentEvent } from './sdkEventMapper.js';
import { CANCELLED } from './streamErrors.js';

/** Consumer callbacks for a turn. Receives Navi {@link AgentEvent}s, not SDK events. */
export type TurnCallbacks = {
	/** Called for each assistant delta/final chunk. `parentToolCallId` is set for sub-agent output. */
	onAssistantDelta?: (text: string, parentToolCallId?: string) => Promise<void> | void;
	/** Called for every normalized agent event (tool/sub-agent/idle/error) for UI mirroring. */
	onAgentEvent?: (event: AgentEvent) => Promise<void> | void;
	shouldCancel?: () => boolean;
	abortSignal?: AbortSignal;
};

export type TurnRunnerDeps = {
	/** Detach + (optionally abort +) disconnect the session on cancellation. */
	beginCancellation: (session: CopilotSession, requestAbort: boolean) => Promise<void>;
	/** Accumulate top-level (non-sub-agent) assistant text into the caller's reply buffer. */
	onMainText: (delta: string) => void;
};

/**
 * Subscribe to a session's event stream and resolve once the session is idle
 * AND all sub-agents have finished. Maps raw SDK events to {@link AgentEvent}
 * (the only SDK-event reader besides the mapper) and preserves the load-bearing
 * behaviors: the unified delta path, the `parentToolCallId` accumulator guard,
 * the assistant-message fallback dedupe, and the sub-agent idle-reset.
 */
export function runTurn(session: CopilotSession, deps: TurnRunnerDeps, callbacks: TurnCallbacks): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const messageIdsWithDelta = new Set<string>();
		const messageIdsWithFallback = new Set<string>();
		const pendingCallbackTasks = new Set<Promise<void>>();
		let activeSubagentCount = 0;
		let sessionIdleReceived = false;
		let settled = false;
		let cancellationCleanup: Promise<void> | undefined;

		const trackCallbackTask = (task: Promise<void>): void => {
			pendingCallbackTasks.add(task);
			task.finally(() => {
				pendingCallbackTasks.delete(task);
			});
		};

		const emitAgentEvent = (event: AgentEvent): void => {
			if (!callbacks.onAgentEvent) {
				return;
			}
			trackCallbackTask(
				Promise.resolve(callbacks.onAgentEvent(event))
					.then(() => {})
					.catch(() => {})
			);
		};

		const emitAssistantDelta = (text: string, parentToolCallId?: string): void => {
			if (!callbacks.onAssistantDelta) {
				return;
			}
			trackCallbackTask(
				Promise.resolve(callbacks.onAssistantDelta(text, parentToolCallId))
					.then(() => {})
					.catch(() => {})
			);
		};

		const settlePendingCallbacks = async (): Promise<void> => {
			while (pendingCallbackTasks.size > 0) {
				await Promise.allSettled([...pendingCallbackTasks]);
			}
		};

		const ensureNotCancelled = (): void => {
			if (callbacks.shouldCancel?.() || callbacks.abortSignal?.aborted) {
				throw new Error(CANCELLED);
			}
		};

		const startCancellationCleanup = (requestAbort: boolean): Promise<void> => {
			if (cancellationCleanup) {
				return cancellationCleanup;
			}
			cancellationCleanup = deps.beginCancellation(session, requestAbort);
			return cancellationCleanup;
		};

		/**
		 * Only resolve once session is idle AND all sub-agents have finished.
		 * We keep listening past session.idle so subagent.completed/failed can
		 * still arrive and decrement the counter before we actually close.
		 */
		const trySettle = (): void => {
			if (settled || !sessionIdleReceived || activeSubagentCount > 0) {
				return;
			}
			settled = true;
			unsubscribe();
			void settlePendingCallbacks().then(() => {
				logAgentFlow('main.gateway', 'waitForIdle:resolved_after_subagents', {
					activeSubagentCount
				});
				resolve();
			});
		};

		const unsubscribe = session.on((raw: SessionEvent) => {
			logSessionEvent(raw);
			const event = toAgentEvent(raw);
			if (event) {
				emitAgentEvent(event);
			}
			try {
				ensureNotCancelled();
			} catch (err) {
				logAgentFlow('main.gateway', 'waitForIdle:cancelled_before_handling_event', {
					error: err
				});
				unsubscribe();
				void startCancellationCleanup(false);
				reject(err);
				return;
			}

			if (!event) {
				return;
			}

			switch (event.type) {
				case 'assistant.delta': {
					if (event.text) {
						messageIdsWithDelta.add(event.messageId);
						if (!event.parentToolCallId) {
							deps.onMainText(event.text);
						}
						emitAssistantDelta(event.text, event.parentToolCallId);
					}
					break;
				}
				case 'assistant.message': {
					if (
						messageIdsWithDelta.has(event.messageId) ||
						messageIdsWithFallback.has(event.messageId)
					) {
						break;
					}
					if (!event.text) {
						break;
					}
					messageIdsWithFallback.add(event.messageId);
					if (!event.parentToolCallId) {
						deps.onMainText(event.text);
					}
					emitAssistantDelta(event.text, event.parentToolCallId);
					logAgentFlow('main.gateway', 'waitForIdle:assistant_message_fallback_applied', {
						textLength: event.text.length,
						textPreview: summarizeText(event.text)
					});
					break;
				}
				case 'subagent.started':
					activeSubagentCount++;
					logAgentFlow('main.gateway', 'waitForIdle:subagent_started', {
						activeSubagentCount
					});
					break;
				case 'subagent.completed':
				case 'subagent.failed':
					activeSubagentCount = Math.max(0, activeSubagentCount - 1);
					// After a sub-agent finishes, the main model will receive its result
					// and continue reasoning, which will produce a fresh session.idle.
					// Reset the flag so we don't settle on the stale pre-subagent idle.
					sessionIdleReceived = false;
					logAgentFlow('main.gateway', 'waitForIdle:subagent_finished', {
						type: event.type,
						activeSubagentCount,
						sessionIdleReset: true
					});
					break;
				case 'session.idle':
					sessionIdleReceived = true;
					logAgentFlow('main.gateway', 'waitForIdle:session_idle_received', {
						activeSubagentCount,
						willWaitForSubagents: activeSubagentCount > 0
					});
					trySettle();
					break;
				case 'session.error':
					unsubscribe();
					reject(new Error(event.message));
					break;
				default:
					break;
			}
		});

		// Handle abort signals
		if (callbacks.abortSignal) {
			const onAbort = () => {
				logAgentFlow('main.gateway', 'waitForIdle:abort_signal_received');
				unsubscribe();
				void startCancellationCleanup(true).finally(() => {
					reject(new Error(CANCELLED));
				});
			};
			if (callbacks.abortSignal.aborted) {
				onAbort();
				return;
			}
			callbacks.abortSignal.addEventListener('abort', onAbort, { once: true });
		}
	});
}
