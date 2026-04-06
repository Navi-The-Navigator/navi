import * as vscode from 'vscode';
import { CopilotClient, CopilotSession, approveAll } from '@github/copilot-sdk';
import type { Tool, MCPServerConfig, SessionEvent } from '@github/copilot-sdk';
import { SYSTEM_PROMPT } from './config';
import { createCopilotClient, resolveModel, resolveProvider } from './modelFactory';
import type { NaviTool } from './naviTool';
import { parseMcpServerSettings, toEnabledMcpConnections } from '../mcp/config';
import type { RenderableMessage } from '../types/chat';
const DEFAULT_STREAM_RETRY_LIMIT = 1;

type StreamCallbacks = {
	onToolStart?: (toolName: string) => Promise<void>;
	onToolEnd?: () => Promise<void>;
	onAssistantDelta?: (delta: string) => Promise<void>;
	shouldCancel?: () => boolean;
	abortSignal?: AbortSignal;
};

/** A stored message used for session history replay. */
type StoredMessage = {
	role: 'user' | 'assistant';
	text: string;
};

export class DeepSeekChatGateway {
	private client?: CopilotClient;
	private sessionMap = new Map<string, CopilotSession>();
	private clientInitPromise?: Promise<CopilotClient>;
	/** In-memory conversation history keyed by session-id. */
	private readonly messageHistory = new Map<string, StoredMessage[]>();

	constructor(private readonly tools: NaviTool[]) {}

	public async streamAssistantReply(sessionId: string, prompt: string, callbacks: StreamCallbacks = {}): Promise<string> {
		let assistantText = '';
		for (let attempt = 0; attempt <= DEFAULT_STREAM_RETRY_LIMIT; attempt += 1) {
			try {
				this.ensureNotCancelled(callbacks);
				const session = await this.getOrCreateSession(sessionId);

				this.appendToHistory(sessionId, 'user', prompt);

				assistantText = '';

				const idlePromise = this.waitForIdle(session, callbacks, (delta) => {
					assistantText += delta;
				});

				await session.send({ prompt });
				await idlePromise;

				this.appendToHistory(sessionId, 'assistant', assistantText);
				return assistantText;
			} catch (error) {
				if (callbacks.shouldCancel?.() || callbacks.abortSignal?.aborted) {
					throw this.normalizeStreamError(new Error('__NAVI_CANCELLED__'));
				}
				if (this.shouldRetryStreamError(error) && attempt < DEFAULT_STREAM_RETRY_LIMIT && !assistantText.trim()) {
					await this.resetForRetry(sessionId);
					continue;
				}
				throw this.normalizeStreamError(error);
			}
		}

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
		for (const session of this.sessionMap.values()) {
			try {
				await session.disconnect();
			} catch {
				// best-effort
			}
		}
		this.sessionMap.clear();

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
		for (const session of this.sessionMap.values()) {
			try {
				await session.disconnect();
			} catch {
				// best-effort
			}
		}
		this.sessionMap.clear();

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
		const client = await createCopilotClient(config);
		await client.start();
		return client;
	}

	private async getOrCreateSession(sessionId: string): Promise<CopilotSession> {
		const existing = this.sessionMap.get(sessionId);
		if (existing) {
			return existing;
		}

		const client = await this.getOrCreateClient();
		const config = vscode.workspace.getConfiguration('navi');
		const model = resolveModel(config);
		const provider = resolveProvider(config);
		const mcpServers = this.resolveMcpServers(config);

		const sdkTools = this.convertTools(this.tools);

		const sessionConfig: Parameters<CopilotClient['createSession']>[0] = {
			sessionId,
			model,
			tools: sdkTools,
			mcpServers,
			onPermissionRequest: approveAll,
			systemMessage: {
				mode: 'replace',
				content: SYSTEM_PROMPT
			}
		};

		if (provider) {
			sessionConfig.provider = provider;
		}

		const session = await client.createSession(sessionConfig);

		this.sessionMap.set(sessionId, session);
		return session;
	}

	/**
	 * Register event listeners and wait until the session is idle.
	 * Returns a promise that resolves when `session.idle` fires.
	 */
	private waitForIdle(
		session: CopilotSession,
		callbacks: StreamCallbacks,
		onDelta: (delta: string) => void
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const unsubscribe = session.on((event: SessionEvent) => {
				try {
					this.ensureNotCancelled(callbacks);
				} catch (err) {
					unsubscribe();
					reject(err);
					return;
				}

				switch (event.type) {
					case 'assistant.message_delta': {
						const delta = event.data.deltaContent;
						if (delta) {
							onDelta(delta);
							if (callbacks.onAssistantDelta) {
								callbacks.onAssistantDelta(delta).catch(() => {});
							}
						}
						break;
					}
					case 'tool.execution_start': {
						const toolName = event.data.toolName ?? 'unknown_tool';
						if (callbacks.onToolStart) {
							callbacks.onToolStart(toolName).catch(() => {});
						}
						break;
					}
					case 'tool.execution_complete': {
						if (callbacks.onToolEnd) {
							callbacks.onToolEnd().catch(() => {});
						}
						break;
					}
					case 'session.idle':
						unsubscribe();
						resolve();
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
					unsubscribe();
					session.abort().catch(() => {});
					reject(new Error('__NAVI_CANCELLED__'));
				};
				if (callbacks.abortSignal.aborted) {
					onAbort();
					return;
				}
				callbacks.abortSignal.addEventListener('abort', onAbort, { once: true });
			}
		});
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
		const session = this.sessionMap.get(sessionId);
		if (session) {
			try {
				await session.disconnect();
			} catch {
				// best-effort
			}
			this.sessionMap.delete(sessionId);
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
