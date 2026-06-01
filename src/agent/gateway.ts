import { logAgentFlow, summarizeText } from './debugLogger.js';
import type { LLMProvider } from './provider/LLMProvider.js';
import { CANCELLED, normalizeStreamError, shouldRetryStreamError } from './streamErrors.js';
import type { TurnCallbacks } from './turnRunner.js';

const DEFAULT_STREAM_RETRY_LIMIT = 1;

/** Public callbacks for a streamed reply (receives normalized AgentEvents). */
export type StreamCallbacks = TurnCallbacks;

/**
 * Thin facade over an {@link LLMProvider}. Owns only the turn-level retry policy
 * and cancellation gate; all backend specifics live behind the provider port.
 *
 * The public `streamAssistantReply(sessionId, prompt, callbacks)` seam is frozen.
 */
export class NaviChatGateway {
	constructor(private readonly provider: LLMProvider) {}

	public async streamAssistantReply(sessionId: string, prompt: string, callbacks: StreamCallbacks = {}): Promise<string> {
		let assistantText = '';
		for (let attempt = 0; attempt <= DEFAULT_STREAM_RETRY_LIMIT; attempt += 1) {
			try {
				logAgentFlow('main.gateway', 'streamAssistantReply:start', {
					sessionId,
					attempt,
					promptPreview: summarizeText(prompt),
					promptLength: prompt.length
				});
				this.ensureNotCancelled(callbacks);
				assistantText = '';

				await this.provider.runTurn(sessionId, prompt, callbacks, (delta) => {
					assistantText += delta;
				});

				logAgentFlow('main.gateway', 'streamAssistantReply:completed', {
					sessionId,
					attempt,
					assistantLength: assistantText.length,
					assistantPreview: summarizeText(assistantText)
				});
				return assistantText;
			} catch (error) {
				logAgentFlow('main.gateway', 'streamAssistantReply:error', {
					sessionId,
					attempt,
					error
				});
				if (callbacks.shouldCancel?.() || callbacks.abortSignal?.aborted) {
					throw normalizeStreamError(new Error(CANCELLED));
				}
				if (shouldRetryStreamError(error) && attempt < DEFAULT_STREAM_RETRY_LIMIT && !assistantText.trim()) {
					logAgentFlow('main.gateway', 'streamAssistantReply:retrying_after_reset', {
						sessionId,
						attempt,
						error,
						assistantLength: assistantText.length
					});
					await this.provider.resetForRetry(sessionId);
					continue;
				}
				throw normalizeStreamError(error);
			}
		}

		logAgentFlow('main.gateway', 'streamAssistantReply:exhausted_attempts', {
			sessionId,
			assistantLength: assistantText.length,
			assistantPreview: summarizeText(assistantText)
		});
		return assistantText;
	}

	public async dispose(): Promise<void> {
		await this.provider.dispose();
	}

	public async invalidateAgent(): Promise<void> {
		await this.provider.invalidate();
	}

	private ensureNotCancelled(callbacks: StreamCallbacks): void {
		if (callbacks.shouldCancel?.() || callbacks.abortSignal?.aborted) {
			throw new Error(CANCELLED);
		}
	}
}
