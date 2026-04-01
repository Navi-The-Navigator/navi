import * as vscode from 'vscode';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, type MessageContent } from '@langchain/core/messages';
import { type DynamicTool, type StructuredToolInterface } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { MultiServerMCPClient, type Connection } from '@langchain/mcp-adapters';
import type { RenderableMessage } from '../types/chat';
import { extractMessageText, getMessageType } from '../utils/message';

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const SYSTEM_PROMPT = 'You are Navi, a practical coding assistant. Keep answers concise, actionable, and developer-friendly.';

type StreamCallbacks = {
	onToolStart?: (toolName: string) => Promise<void>;
	onAssistantDelta?: (delta: string) => Promise<void>;
};

export class DeepSeekChatGateway {
	private agent?: ReturnType<typeof createReactAgent>;
	private agentInitPromise?: Promise<ReturnType<typeof createReactAgent>>;
	private mcpClient?: MultiServerMCPClient;
	private readonly checkpointer = new MemorySaver();

	constructor(private readonly tools: DynamicTool[]) {}

	public async streamAssistantReply(sessionId: string, prompt: string, callbacks: StreamCallbacks = {}): Promise<string> {
		const agent = await this.getOrCreateAgent();
		const stream = await agent.streamEvents(
			{
				messages: [new HumanMessage(prompt)]
			},
			{
				version: 'v2',
				configurable: {
					thread_id: sessionId
				}
			}
		);

		let assistantText = '';
		for await (const chunk of stream) {
			if (chunk.event === 'on_tool_start') {
				const toolName = chunk.name ?? 'unknown_tool';
				if (callbacks.onToolStart) {
					await callbacks.onToolStart(toolName);
				}
				continue;
			}

			if (chunk.event === 'on_tool_end') {
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
		if (!this.mcpClient) {
			return;
		}

		await this.mcpClient.close();
		this.mcpClient = undefined;
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
		const apiKey = (process.env.DEEPSEEK_API_KEY ?? config.get<string>('deepseekApiKey') ?? '').trim();
		if (!apiKey) {
			throw new Error('缺少 API Key。请设置环境变量 DEEPSEEK_API_KEY 或在 Settings 中配置 navi.deepseekApiKey。');
		}

		const model = config.get<string>('deepseekModel', DEFAULT_DEEPSEEK_MODEL);
		const baseURL = config.get<string>('deepseekBaseUrl', DEFAULT_DEEPSEEK_BASE_URL);
		const temperature = config.get<number>('temperature', 0.2);

		const chatModel = new ChatOpenAI({
			apiKey,
			model,
			temperature,
			configuration: { baseURL }
		});

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

		let parsedServers: unknown;
		try {
			parsedServers = JSON.parse(mcpServersJson);
		} catch {
			throw new Error('navi.mcpServersJson 不是有效的 JSON。');
		}

		if (!parsedServers || typeof parsedServers !== 'object' || Array.isArray(parsedServers)) {
			throw new Error(
				'navi.mcpServersJson 必须是对象，例如 {"math":{"transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-math"]}}。'
			);
		}

		this.mcpClient = new MultiServerMCPClient({
			mcpServers: parsedServers as Record<string, Connection>,
			onConnectionError: 'ignore',
			prefixToolNameWithServerName: true,
			useStandardContentBlocks: true
		});

		return await this.mcpClient.getTools();
	}
}
