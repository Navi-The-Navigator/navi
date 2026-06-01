import * as vscode from 'vscode';

/**
 * Single source of truth for reading `navi.*` settings.
 *
 * Every component resolves settings through the functions here so that
 * precedence rules (e.g. API-key setting vs `NAVI_API_KEY`, MCP-JSON env vs
 * setting) and defaults live in exactly one place. Callers may pass an explicit
 * {@link vscode.WorkspaceConfiguration} (e.g. inside a change handler) or rely
 * on the default live read.
 */

export type AuthMode = 'copilot' | 'byok';

export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_MODEL = 'gpt-5-mini';
export const DEFAULT_STREAMING_ENABLED = true;

function naviConfiguration(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration('navi');
}

export function resolveAuthMode(config: vscode.WorkspaceConfiguration = naviConfiguration()): AuthMode {
	const value = (config.get<string>('authMode') ?? 'copilot').trim().toLowerCase();
	return value === 'byok' ? 'byok' : 'copilot';
}

/** The API key stored in VS Code settings (no env fallback). */
export function resolveConfiguredApiKey(config: vscode.WorkspaceConfiguration = naviConfiguration()): string {
	return (config.get<string>('apiKey') ?? '').trim();
}

/** The API key supplied via the `NAVI_API_KEY` environment variable. */
export function resolveEnvApiKey(): string {
	return (process.env.NAVI_API_KEY ?? '').trim();
}

/** Effective API key: the configured setting takes precedence over the env var. */
export function resolveApiKey(config: vscode.WorkspaceConfiguration = naviConfiguration()): string {
	const configuredApiKey = resolveConfiguredApiKey(config);
	if (configuredApiKey) {
		return configuredApiKey;
	}
	return resolveEnvApiKey();
}

export function resolveBaseUrl(config: vscode.WorkspaceConfiguration = naviConfiguration()): string {
	const configuredBaseUrl = (config.get<string>('apiBaseUrl', DEFAULT_API_BASE_URL) ?? '').trim();
	return configuredBaseUrl || DEFAULT_API_BASE_URL;
}

export function resolveModel(config: vscode.WorkspaceConfiguration = naviConfiguration()): string {
	const configuredModel = (config.get<string>('model', DEFAULT_MODEL) ?? '').trim();
	return configuredModel || DEFAULT_MODEL;
}

export function resolveStreaming(config: vscode.WorkspaceConfiguration = naviConfiguration()): boolean {
	return config.get<boolean>('streaming', DEFAULT_STREAMING_ENABLED);
}

export function resolveMcpEnabled(config: vscode.WorkspaceConfiguration = naviConfiguration()): boolean {
	return config.get<boolean>('mcpEnabled', false);
}

/** Runtime MCP-servers JSON: the `NAVI_MCP_SERVERS_JSON` env var takes precedence over the setting. */
export function resolveMcpServersJson(config: vscode.WorkspaceConfiguration = naviConfiguration()): string {
	return (process.env.NAVI_MCP_SERVERS_JSON ?? config.get<string>('mcpServersJson') ?? '').trim();
}

export function resolveCopilotCliPath(config: vscode.WorkspaceConfiguration = naviConfiguration()): string {
	return (config.get<string>('copilotCliPath') ?? '').trim();
}

export function resolveDebugCopilotCliArgs(config: vscode.WorkspaceConfiguration = naviConfiguration()): boolean {
	return config.get<boolean>('debugCopilotCliArgs', false);
}

export function resolveDebugAgentReplyFlow(config: vscode.WorkspaceConfiguration = naviConfiguration()): boolean {
	return config.get<boolean>('debugAgentReplyFlow', false);
}

export function resolveDebugAgentReplyFlowReveal(config: vscode.WorkspaceConfiguration = naviConfiguration()): boolean {
	return config.get<boolean>('debugAgentReplyFlowReveal', false);
}

export interface NaviConfigSnapshot {
	authMode: AuthMode;
	apiKey: string;
	apiBaseUrl: string;
	model: string;
	streaming: boolean;
	mcpEnabled: boolean;
	mcpServersJson: string;
	copilotCliPath: string;
	debugCopilotCliArgs: boolean;
	debugAgentReplyFlow: boolean;
	debugAgentReplyFlowReveal: boolean;
}

/** Resolve all `navi.*` settings at once into an immutable snapshot. */
export function readNaviConfig(config: vscode.WorkspaceConfiguration = naviConfiguration()): NaviConfigSnapshot {
	return {
		authMode: resolveAuthMode(config),
		apiKey: resolveApiKey(config),
		apiBaseUrl: resolveBaseUrl(config),
		model: resolveModel(config),
		streaming: resolveStreaming(config),
		mcpEnabled: resolveMcpEnabled(config),
		mcpServersJson: resolveMcpServersJson(config),
		copilotCliPath: resolveCopilotCliPath(config),
		debugCopilotCliArgs: resolveDebugCopilotCliArgs(config),
		debugAgentReplyFlow: resolveDebugAgentReplyFlow(config),
		debugAgentReplyFlowReveal: resolveDebugAgentReplyFlowReveal(config)
	};
}

/** Settings whose change requires rebuilding the Copilot session/agent. */
const MODEL_AFFECTING_KEYS = [
	'navi.authMode',
	'navi.apiKey',
	'navi.apiBaseUrl',
	'navi.model',
	'navi.mcpEnabled',
	'navi.mcpServersJson'
] as const;

/** True when a configuration change touches a setting that affects the LLM session. */
export function affectsModel(event: vscode.ConfigurationChangeEvent): boolean {
	return MODEL_AFFECTING_KEYS.some((key) => event.affectsConfiguration(key));
}
