import * as vscode from 'vscode';
import { approveAll } from '@github/copilot-sdk';
import type { CopilotClient, CustomAgentConfig, MCPServerConfig, Tool } from '@github/copilot-sdk';
import { SYSTEM_PROMPT, withWorkingDirectory } from '../prompts/index.js';
import { logAgentFlow } from './debugLogger.js';
import { resolveMcpEnabled, resolveMcpServersJson, resolveModel, resolveStreaming } from '../settings/naviConfig.js';
import { resolveProvider } from './modelFactory.js';
import { parseMcpServerSettings, toEnabledMcpConnections } from '../mcp/config.js';
import type { NaviTool } from './naviTool';

/** The SDK config shape accepted by both createSession and resumeSession. */
export type NaviSessionConfig = Parameters<CopilotClient['resumeSession']>[1];

/** Build the SDK session config from the current settings + the registered tools/sub-agents. */
export function buildSessionConfig(tools: NaviTool[], customAgents?: CustomAgentConfig[]): NaviSessionConfig {
	const config = vscode.workspace.getConfiguration('navi');
	const model = resolveModel(config);
	const streaming = resolveStreaming(config);
	const workingDirectory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const provider = resolveProvider(config);
	const mcpServers = resolveMcpServers(config);

	const sdkTools = convertTools(tools);
	const mcpServerNames = Object.keys(mcpServers ?? {});
	const customAgentNames = (customAgents ?? []).map((agent) => agent.name);
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

	// Inject the working directory into every prompt. The main agent uses
	// `mode: 'replace'`, so the CLI emits our content verbatim with no
	// environment block; we add cwd ourselves here, and to each sub-agent prompt
	// so they know the cwd regardless of how the runtime assembles their prompt.
	const resolvedCustomAgents = customAgents?.map((agent) => ({
		...agent,
		prompt: withWorkingDirectory(agent.prompt, workingDirectory),
		...(mcpServers ? { mcpServers } : {})
	}));

	const sessionConfig: NaviSessionConfig = {
		model,
		workingDirectory,
		streaming,
		tools: sdkTools,
		mcpServers,
		customAgents: resolvedCustomAgents,
		onPermissionRequest: approveAll,
		systemMessage: {
			mode: 'replace',
			content: withWorkingDirectory(SYSTEM_PROMPT, workingDirectory)
		}
	};

	if (provider) {
		sessionConfig.provider = provider;
	}

	return sessionConfig;
}

/** Convert NaviTool[] → SDK Tool[] */
export function convertTools(naviTools: NaviTool[]): Tool[] {
	return naviTools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: (tool.inputSchema ?? {
			type: 'object',
			properties: {
				input: { type: 'string', description: 'Raw input string (JSON or plain text)' }
			},
			required: ['input']
		}) as Tool['parameters'],
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
export function resolveMcpServers(config: vscode.WorkspaceConfiguration): Record<string, MCPServerConfig> | undefined {
	const mcpEnabled = resolveMcpEnabled(config);
	if (!mcpEnabled) {
		return undefined;
	}

	const mcpServersJson = resolveMcpServersJson(config);
	if (!mcpServersJson) {
		return undefined;
	}

	let parsedServers;
	try {
		parsedServers = parseMcpServerSettings(mcpServersJson);
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error('navi.mcpServersJson is not valid JSON.');
		}
		throw error;
	}

	const normalizedServers = toEnabledMcpConnections(parsedServers);
	if (Object.keys(normalizedServers).length === 0) {
		return undefined;
	}

	return normalizedServers;
}
