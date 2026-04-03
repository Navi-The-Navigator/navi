import * as vscode from 'vscode';
import { HumanMessage, type MessageContent } from '@langchain/core/messages';
import { type DynamicTool, type StructuredToolInterface } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { SYSTEM_PROMPT } from './config';
import { createDeepSeekChatModel, resolveRecursionLimit } from './modelFactory';
import { parseMcpServerSettings, toEnabledMcpConnections } from '../mcp/config';
import type { RenderableMessage } from '../types/chat';
import { extractMessageText, getMessageType } from '../utils/message';
const DEFAULT_STREAM_RETRY_LIMIT = 1;

type StreamCallbacks = {
	onToolStart?: (toolName: string) => Promise<void>;
	onToolEnd?: () => Promise<void>;
	onAssistantDelta?: (delta: string) => Promise<void>;
	shouldCancel?: () => boolean;
	abortSignal?: AbortSignal;
};

export class DeepSeekChatGateway {
	private agent?: ReturnType<typeof createReactAgent>;
	private agentInitPromise?: Promise<ReturnType<typeof createReactAgent>>;
	private mcpClient?: MultiServerMCPClient;
	private readonly checkpointer = new MemorySaver();

	constructor(private readonly tools: DynamicTool[]) {}

	public async streamAssistantReply(sessionId: string, prompt: string, callbacks: StreamCallbacks = {}): Promise<string> {
		let assistantText = '';
		for (let attempt = 0; attempt <= DEFAULT_STREAM_RETRY_LIMIT; attempt += 1) {
			try {
				this.ensureNotCancelled(callbacks);
				const agent = await this.getOrCreateAgent();
				const recursionLimit = resolveRecursionLimit(vscode.workspace.getConfiguration('navi'));
				const stream = await agent.streamEvents(
					{
						messages: [new HumanMessage(prompt)]
					},
					{
						version: 'v2',
						recursionLimit,
						signal: callbacks.abortSignal,
						configurable: {
							thread_id: sessionId
						}
					}
				);

				for await (const chunk of stream) {
					this.ensureNotCancelled(callbacks);
					if (chunk.event === 'on_tool_start') {
						const toolName = chunk.name ?? 'unknown_tool';
						if (callbacks.onToolStart) {
							await callbacks.onToolStart(toolName);
						}
						continue;
					}

					if (chunk.event === 'on_tool_end') {
						if (callbacks.onToolEnd) {
							await callbacks.onToolEnd();
						}
						continue;
					}

					if (chunk.event !== 'on_chat_model_stream') {
						continue;
					}

					const modelChunk = chunk.data?.chunk;
					const delta = extractMessageText(modelChunk?.content as MessageContent | undefined);
					if (!delta) {
						continue;
					}

					assistantText += delta;
					if (callbacks.onAssistantDelta) {
						await callbacks.onAssistantDelta(delta);
					}
				}
				return assistantText;
			} catch (error) {
				if (callbacks.shouldCancel?.() || callbacks.abortSignal?.aborted) {
					throw this.normalizeStreamError(new Error('__NAVI_CANCELLED__'));
				}
				if (this.shouldRetryStreamError(error) && attempt < DEFAULT_STREAM_RETRY_LIMIT && !assistantText.trim()) {
					await this.resetAgentForRetry();
					continue;
				}
				throw this.normalizeStreamError(error);
			}
		}

		return assistantText;
	}

	public async loadSessionMessages(sessionId: string): Promise<RenderableMessage[]> {
		if (!this.agent) {
			return [];
		}

		const state = await this.agent.getState({
			configurable: {
				thread_id: sessionId
			}
		});

		const values = state.values as { messages?: unknown } | undefined;
		const messages = values?.messages;
		if (!Array.isArray(messages)) {
			return [];
		}

		return messages
			.map((message) => {
				const type = getMessageType(message);
				if (type !== 'human' && type !== 'ai') {
					return undefined;
				}

				const text = extractMessageText((message as { content?: MessageContent }).content).trim();
				if (!text) {
					return undefined;
				}

				return {
					role: type === 'human' ? 'user' : 'assistant',
					text
				} as RenderableMessage;
			})
			.filter((item): item is RenderableMessage => item !== undefined);
	}

	public async dispose(): Promise<void> {
		await this.disposeMcpClient();
	}

	public async invalidateAgent(): Promise<void> {
		this.agent = undefined;
		this.agentInitPromise = undefined;
		await this.disposeMcpClient();
	}

	private async getOrCreateAgent(): Promise<ReturnType<typeof createReactAgent>> {
		if (this.agent) {
			return this.agent;
		}

		if (this.agentInitPromise) {
			return this.agentInitPromise;
		}

		this.agentInitPromise = this.createAgent();
		try {
			this.agent = await this.agentInitPromise;
			return this.agent;
		} finally {
			this.agentInitPromise = undefined;
		}
	}

	private async createAgent(): Promise<ReturnType<typeof createReactAgent>> {
		const config = vscode.workspace.getConfiguration('navi');
		const chatModel = createDeepSeekChatModel(config);

		const tools = [...this.tools, ...(await this.loadMcpTools(config))];
		return createReactAgent({
			llm: chatModel,
			tools,
			prompt: SYSTEM_PROMPT,
			checkpointer: this.checkpointer
		});
	}

	private async loadMcpTools(config: vscode.WorkspaceConfiguration): Promise<StructuredToolInterface[]> {
		const mcpEnabled = config.get<boolean>('mcpEnabled', false);
		if (!mcpEnabled) {
			return [];
		}

		const mcpServersJson = (process.env.NAVI_MCP_SERVERS_JSON ?? config.get<string>('mcpServersJson') ?? '').trim();
		if (!mcpServersJson) {
			throw new Error(
				'MCP 已启用，但未找到服务配置。请设置环境变量 NAVI_MCP_SERVERS_JSON 或在 Settings 中配置 navi.mcpServersJson。'
			);
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
			return [];
		}

		this.mcpClient = new MultiServerMCPClient({
			mcpServers: normalizedServers,
			onConnectionError: 'ignore',
			prefixToolNameWithServerName: true,
			useStandardContentBlocks: true
		});

		return await this.mcpClient.getTools();
	}

	private async resetAgentForRetry(): Promise<void> {
		await this.invalidateAgent();
	}

	private async disposeMcpClient(): Promise<void> {
		if (!this.mcpClient) {
			return;
		}

		await this.mcpClient.close();
		this.mcpClient = undefined;
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
