import * as vscode from 'vscode';
import { CopilotClient, CopilotSession, approveAll } from '@github/copilot-sdk';
import type { Tool, MCPServerConfig, SessionEvent, CustomAgentConfig } from '@github/copilot-sdk';
import { SYSTEM_PROMPT } from './config.js';
import { logAgentFlow, summarizeText } from './debugLogger.js';
import { createCopilotClient, resolveModel, resolveProvider, resolveStreaming } from './modelFactory.js';
import type { NaviTool } from './naviTool';
import { parseMcpServerSettings, toEnabledMcpConnections } from '../mcp/config.js';
import type { RenderableMessage } from '../types/chat';
const DEFAULT_STREAM_RETRY_LIMIT = 1;

type StreamCallbacks = {
	onAssistantDelta?: (
		delta: string,
		event: Extract<SessionEvent, { type: 'assistant.message' | 'assistant.message_delta' }>
	) => Promise<void>;
	onSessionEvent?: (event: SessionEvent) => Promise<void> | void;
	shouldCancel?: () => boolean;
	abortSignal?: AbortSignal;
};

type ChatGatewayConfig = {
	tools: NaviTool[];
	customAgents?: CustomAgentConfig[];
};

/** A stored message used for session history replay. */
type StoredMessage = {
	role: 'user' | 'assistant';
	text: string;
};

export class NaviChatGateway {
	private client?: CopilotClient;
	private sessionMap = new Map<string, CopilotSession>();
	private readonly resumableSessionIds = new Set<string>();
	private clientInitPromise?: Promise<CopilotClient>;
	/** In-memory conversation history keyed by session-id. */
	private readonly messageHistory = new Map<string, StoredMessage[]>();
	private readonly tools: NaviTool[];
	private readonly customAgents?: CustomAgentConfig[];

	constructor(config: ChatGatewayConfig) {
		this.tools = config.tools;
		this.customAgents = config.customAgents;
	}

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
				const session = await this.getOrCreateSession(sessionId);
				logAgentFlow('main.gateway', 'streamAssistantReply:session_ready', {
					sessionId,
					attempt
				});

				this.appendToHistory(sessionId, 'user', prompt);

				assistantText = '';

				const idlePromise = this.waitForIdle(session, callbacks, (delta, event) => {
					if (!event.data.parentToolCallId) {
						assistantText += delta;
					}
				});

				logAgentFlow('main.gateway', 'streamAssistantReply:send_prompt', {
					sessionId,
					attempt
				});
				await session.send({ prompt });
				await idlePromise;
				logAgentFlow('main.gateway', 'streamAssistantReply:idle_reached', {
					sessionId,
					attempt,
					assistantLength: assistantText.length,
					assistantPreview: summarizeText(assistantText)
				});

				this.appendToHistory(sessionId, 'assistant', assistantText);
				logAgentFlow('main.gateway', 'streamAssistantReply:completed', {
					sessionId,
					attempt,
					assistantLength: assistantText.length
				});
				return assistantText;
			} catch (error) {
				logAgentFlow('main.gateway', 'streamAssistantReply:error', {
					sessionId,
					attempt,
					error
				});
				if (callbacks.shouldCancel?.() || callbacks.abortSignal?.aborted) {
					throw this.normalizeStreamError(new Error('__NAVI_CANCELLED__'));
				}
				if (this.shouldRetryStreamError(error) && attempt < DEFAULT_STREAM_RETRY_LIMIT && !assistantText.trim()) {
					logAgentFlow('main.gateway', 'streamAssistantReply:retrying_after_reset', {
						sessionId,
						attempt,
						error,
						assistantLength: assistantText.length
					});
					await this.resetForRetry(sessionId);
					continue;
				}
				throw this.normalizeStreamError(error);
			}
		}

		logAgentFlow('main.gateway', 'streamAssistantReply:exhausted_attempts', {
			sessionId,
			assistantLength: assistantText.length,
			assistantPreview: summarizeText(assistantText)
		});
		return assistantText;
	}

	public async loadSessionMessages(sessionId: string): Promise<RenderableMessage[]> {
		const history = this.messageHistory.get(sessionId);
		if (!history) {
			return [];
		}

		return history
			.filter((msg) => msg.text.trim())
			.map((msg) => ({
				role: msg.role,
				text: msg.text
			}));
	}

	public async dispose(): Promise<void> {
		for (const sessionId of [...this.sessionMap.keys()]) {
			await this.disposeSession(sessionId, false);
		}
		this.resumableSessionIds.clear();

		if (this.client) {
			try {
				await this.client.stop();
			} catch {
				// best-effort
			}
			this.client = undefined;
		}
	}

	public async invalidateAgent(): Promise<void> {
		for (const sessionId of [...this.sessionMap.keys()]) {
			await this.disposeSession(sessionId, true);
		}

		if (this.client) {
			try {
				await this.client.stop();
			} catch {
				// best-effort
			}
			this.client = undefined;
			this.clientInitPromise = undefined;
		}
	}

	// ------------------------------------------------------------------
	// Private helpers
	// ------------------------------------------------------------------

	private async getOrCreateClient(): Promise<CopilotClient> {
		if (this.client) {
			return this.client;
		}
		if (this.clientInitPromise) {
			return this.clientInitPromise;
		}

		this.clientInitPromise = this.initClient();
		try {
			this.client = await this.clientInitPromise;
			return this.client;
		} finally {
			this.clientInitPromise = undefined;
		}
	}

	private async initClient(): Promise<CopilotClient> {
		const config = vscode.workspace.getConfiguration('navi');
		logAgentFlow('main.gateway', 'initClient:start');
		const client = await createCopilotClient(config);
		await client.start();
		logAgentFlow('main.gateway', 'initClient:ready');
		return client;
	}

	private async getOrCreateSession(sessionId: string): Promise<CopilotSession> {
		const existing = this.sessionMap.get(sessionId);
		if (existing) {
			return existing;
		}

		const client = await this.getOrCreateClient();
		const sessionConfig = this.buildSessionConfig();
		const shouldResume = this.resumableSessionIds.has(sessionId) || this.messageHistory.has(sessionId);
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

	private buildSessionConfig(): Parameters<CopilotClient['resumeSession']>[1] {
		const config = vscode.workspace.getConfiguration('navi');
		const model = resolveModel(config);
		const streaming = resolveStreaming(config);
		const workingDirectory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const provider = resolveProvider(config);
		const mcpServers = this.resolveMcpServers(config);

		const sdkTools = this.convertTools(this.tools);
		const mcpServerNames = Object.keys(mcpServers ?? {});
		const customAgentNames = (this.customAgents ?? []).map((agent) => agent.name);
		logAgentFlow('main.gateway', 'createSession:config_prepared', {
			model,
			streaming,
			providerType: provider?.type,
			toolCount: sdkTools.length,
			toolNames: sdkTools.map((tool) => tool.name),
			mcpServerCount: mcpServerNames.length,
			mcpServers: mcpServerNames,
			customAgentCount: customAgentNames.length,
			customAgents: customAgentNames
		});

		const customAgents = mcpServers
			? (this.customAgents ?? []).map((agent) => ({ ...agent, mcpServers }))
			: this.customAgents;

		const sessionConfig: Parameters<CopilotClient['resumeSession']>[1] = {
			model,
			workingDirectory,
			streaming,
			tools: sdkTools,
			mcpServers,
			customAgents,
			onPermissionRequest: approveAll,
			systemMessage: {
				mode: 'replace',
				content: SYSTEM_PROMPT
			}
		};

		if (provider) {
			sessionConfig.provider = provider;
		}

		return sessionConfig;
	}

	/**
	 * Register event listeners and wait until the session is idle.
	 * Returns a promise that resolves when `session.idle` fires.
	 */
	private waitForIdle(
		session: CopilotSession,
		callbacks: StreamCallbacks,
		onDelta: (delta: string, event: Extract<SessionEvent, { type: 'assistant.message' | 'assistant.message_delta' }>) => void
	): Promise<void> {
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

			const emitSessionEvent = (event: SessionEvent): void => {
				if (!callbacks.onSessionEvent) {
					return;
				}
				trackCallbackTask(
					Promise.resolve(callbacks.onSessionEvent(event))
						.then(() => {})
						.catch(() => {})
				);
			};

			const emitAssistantDelta = (
				delta: string,
				event: Extract<SessionEvent, { type: 'assistant.message' | 'assistant.message_delta' }>
			): void => {
				if (!callbacks.onAssistantDelta) {
					return;
				}
				trackCallbackTask(
					callbacks
						.onAssistantDelta(delta, event)
						.then(() => {})
						.catch(() => {})
				);
			};

			const settlePendingCallbacks = async (): Promise<void> => {
				while (pendingCallbackTasks.size > 0) {
					await Promise.allSettled([...pendingCallbackTasks]);
				}
			};

			const startCancellationCleanup = (requestAbort: boolean): Promise<void> => {
				if (cancellationCleanup) {
					return cancellationCleanup;
				}

				const mappedSession = this.sessionMap.get(session.sessionId);
				if (mappedSession === session) {
					this.sessionMap.delete(session.sessionId);
				}
				this.resumableSessionIds.add(session.sessionId);

				cancellationCleanup = (async () => {
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

			const unsubscribe = session.on((event: SessionEvent) => {
				this.logSessionEvent(event);
				emitSessionEvent(event);
				try {
					this.ensureNotCancelled(callbacks);
				} catch (err) {
					logAgentFlow('main.gateway', 'waitForIdle:cancelled_before_handling_event', {
						error: err
					});
					unsubscribe();
					void startCancellationCleanup(false);
					reject(err);
					return;
				}

				switch (event.type) {
					case 'assistant.message_delta': {
						const delta = event.data.deltaContent;
						if (delta) {
							messageIdsWithDelta.add(event.data.messageId);
							onDelta(delta, event);
							emitAssistantDelta(delta, event);
						}
						break;
					}
					case 'assistant.message': {
						if (
							messageIdsWithDelta.has(event.data.messageId) ||
							messageIdsWithFallback.has(event.data.messageId)
						) {
							break;
						}
						const messageText = this.extractAssistantMessageText(event.data);
						if (!messageText) {
							break;
						}
						messageIdsWithFallback.add(event.data.messageId);
						onDelta(messageText, event);
						emitAssistantDelta(messageText, event);
						logAgentFlow('main.gateway', 'waitForIdle:assistant_message_fallback_applied', {
							textLength: messageText.length,
							textPreview: summarizeText(messageText)
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
						reject(new Error((event.data as { message?: string }).message ?? 'Session error'));
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
						reject(new Error('__NAVI_CANCELLED__'));
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

	private logSessionEvent(event: SessionEvent): void {
		switch (event.type) {
			case 'assistant.message_delta': {
				const delta = event.data.deltaContent ?? '';
				logAgentFlow('main.gateway.event', 'assistant.message_delta', {
					deltaLength: delta.length,
					deltaPreview: summarizeText(delta)
				});
				break;
			}
			case 'assistant.message': {
				const text = this.extractAssistantMessageText(event.data);
				logAgentFlow('main.gateway.event', 'assistant.message', {
					extractedLength: text.length,
					extractedPreview: summarizeText(text)
				});
				break;
			}
			case 'tool.execution_start':
				logAgentFlow('main.gateway.event', 'tool.execution_start', {
					toolName: event.data.toolName ?? 'unknown_tool'
				});
				break;
			case 'tool.execution_complete':
				logAgentFlow('main.gateway.event', 'tool.execution_complete', {
					toolCallId: event.data.toolCallId,
					success: event.data.success
				});
				break;
			case 'session.error':
				logAgentFlow('main.gateway.event', 'session.error', {
					message: (event.data as { message?: string }).message ?? 'Session error'
				});
				break;
			case 'session.idle':
				logAgentFlow('main.gateway.event', 'session.idle', {
					aborted: !!event.data.aborted,
					backgroundAgents: event.data.backgroundTasks?.agents?.length ?? 0,
					backgroundShells: event.data.backgroundTasks?.shells?.length ?? 0
				});
				break;
			default:
				logAgentFlow('main.gateway.event', event.type);
				break;
		}
	}

	private extractAssistantMessageText(data: unknown): string {
		if (!data || typeof data !== 'object') {
			return '';
		}

		const root = data as Record<string, unknown>;
		const direct = this.extractTextFromContentLike(root.content);
		if (direct) {
			return direct;
		}

		const fromMessage = this.extractTextFromContentLike((root.message as Record<string, unknown> | undefined)?.content);
		if (fromMessage) {
			return fromMessage;
		}

		const textLike = [root.text, root.markdown, root.contentText]
			.filter((item) => typeof item === 'string')
			.join('\n')
			.trim();
		if (textLike) {
			return textLike;
		}

		return '';
	}

	private extractTextFromContentLike(content: unknown): string {
		if (!content) {
			return '';
		}

		if (typeof content === 'string') {
			return content.trim();
		}

		if (!Array.isArray(content)) {
			return '';
		}

		const texts = content
			.map((item) => {
				if (!item || typeof item !== 'object') {
					return '';
				}
				const record = item as Record<string, unknown>;
				if (typeof record.text === 'string') {
					return record.text;
				}
				const nestedText = record.text as Record<string, unknown> | undefined;
				if (nestedText && typeof nestedText.content === 'string') {
					return nestedText.content;
				}
				return '';
			})
			.filter(Boolean)
			.join('\n')
			.trim();

		return texts;
	}

	/** Convert NaviTool[] → SDK Tool[] */
	private convertTools(naviTools: NaviTool[]): Tool[] {
		return naviTools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: {
				type: 'object',
				properties: {
					input: { type: 'string', description: 'Raw input string (JSON or plain text)' }
				},
				required: ['input']
			},
			handler: async (args: unknown) => {
				const rawInput = typeof args === 'object' && args !== null && 'input' in args
					? String((args as { input: unknown }).input)
					: typeof args === 'string'
						? args
						: JSON.stringify(args);
				return await tool.func(rawInput);
			},
			skipPermission: true
		}));
	}

	/** Resolve MCP server configuration from workspace settings. */
	private resolveMcpServers(config: vscode.WorkspaceConfiguration): Record<string, MCPServerConfig> | undefined {
		const mcpEnabled = config.get<boolean>('mcpEnabled', false);
		if (!mcpEnabled) {
			return undefined;
		}

		const mcpServersJson = (process.env.NAVI_MCP_SERVERS_JSON ?? config.get<string>('mcpServersJson') ?? '').trim();
		if (!mcpServersJson) {
			return undefined;
		}

		let parsedServers;
		try {
			parsedServers = parseMcpServerSettings(mcpServersJson);
		} catch (error) {
			if (error instanceof SyntaxError) {
				throw new Error('navi.mcpServersJson 不是有效的 JSON。');
			}
			throw error;
		}

		const normalizedServers = toEnabledMcpConnections(parsedServers);
		if (Object.keys(normalizedServers).length === 0) {
			return undefined;
		}

		return normalizedServers;
	}

	private appendToHistory(sessionId: string, role: 'user' | 'assistant', text: string): void {
		let history = this.messageHistory.get(sessionId);
		if (!history) {
			history = [];
			this.messageHistory.set(sessionId, history);
		}
		history.push({ role, text });
	}

	private async resetForRetry(sessionId: string): Promise<void> {
		await this.disposeSession(sessionId, true);
	}

	private async disposeSession(sessionId: string, resumable: boolean): Promise<void> {
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

	private shouldRetryStreamError(error: unknown): boolean {
		const message = this.getErrorMessage(error).toLowerCase();
		if (message.includes('__navi_cancelled__')) {
			return false;
		}
		if (message.includes('aborterror')) {
			return false;
		}
		return (
			message.includes('terminated') ||
			message.includes('abort') ||
			message.includes('aborted') ||
			message.includes('timeout') ||
			message.includes('timed out') ||
			message.includes('econnreset') ||
			message.includes('socket hang up') ||
			message.includes('fetch failed')
		);
	}

	private normalizeStreamError(error: unknown): Error {
		const message = this.getErrorMessage(error);
		const lower = message.toLowerCase();
		if (lower.includes('__navi_cancelled__')) {
			return new Error('用户已取消本次生成。');
		}
		if (lower.includes('aborterror')) {
			return new Error('用户已取消本次生成。');
		}
		if (lower.includes('terminated') || lower.includes('abort')) {
			return new Error('连接被中断（terminated）。已自动重试一次；如仍失败，请重试或降低任务复杂度。');
		}
		if (lower.includes('timeout') || lower.includes('timed out')) {
			return new Error('请求超时。请重试，或拆分为更小的步骤后再请求。');
		}
		return error instanceof Error ? error : new Error(message);
	}

	private getErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	private ensureNotCancelled(callbacks: StreamCallbacks): void {
		if (callbacks.shouldCancel?.() || callbacks.abortSignal?.aborted) {
			throw new Error('__NAVI_CANCELLED__');
		}
	}
}
