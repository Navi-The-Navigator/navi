import * as vscode from 'vscode';
import { CopilotClient } from '@github/copilot-sdk';
import type { CopilotClientOptions, SessionConfig } from '@github/copilot-sdk';

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-reasoner';
export const DEFAULT_RECURSION_LIMIT = 150;

/**
 * Create a {@link CopilotClient}.
 *
 * The client uses stdio transport to the bundled CLI and does NOT
 * require a logged-in GitHub user (BYOK credentials are passed at
 * session-creation time via {@link resolveProvider}).
 */
export function createCopilotClient(): CopilotClient {
	const options: CopilotClientOptions = {
		useLoggedInUser: false,
		logLevel: 'error'
	};

	return new CopilotClient(options);
}

/**
 * Build the BYOK provider config for session creation.
 */
export function resolveProvider(
	config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('navi')
): SessionConfig['provider'] {
	const apiKey = resolveApiKey(config);
	if (!apiKey) {
		throw new Error('缺少 API Key。请先通过 Settings 配置 navi.deepseekApiKey，或确认使用环境变量 DEEPSEEK_API_KEY。');
	}

	return {
		type: 'openai',
		baseUrl: resolveBaseUrl(config),
		apiKey
	};
}

export function resolveApiKey(config: vscode.WorkspaceConfiguration): string {
	const configuredApiKey = (config.get<string>('deepseekApiKey') ?? '').trim();
	if (configuredApiKey) {
		return configuredApiKey;
	}

	return (process.env.DEEPSEEK_API_KEY ?? '').trim();
}

export function resolveBaseUrl(config: vscode.WorkspaceConfiguration): string {
	const configuredBaseUrl = (config.get<string>('deepseekBaseUrl', DEFAULT_DEEPSEEK_BASE_URL) ?? '').trim();
	return configuredBaseUrl || DEFAULT_DEEPSEEK_BASE_URL;
}

export function resolveModel(config: vscode.WorkspaceConfiguration): string {
	const configuredModel = (config.get<string>('deepseekModel', DEFAULT_DEEPSEEK_MODEL) ?? '').trim();
	return configuredModel || DEFAULT_DEEPSEEK_MODEL;
}

export function resolveTemperature(config: vscode.WorkspaceConfiguration, override?: number): number | undefined {
	if (override !== undefined) {
		return override;
	}
	const value = config.get<number>('temperature', 0.2);
	return Number.isFinite(value) ? value : 0.2;
}

export function resolveRecursionLimit(config: vscode.WorkspaceConfiguration): number {
	const value = config.get<number>('recursionLimit', DEFAULT_RECURSION_LIMIT);
	if (!Number.isFinite(value)) {
		return DEFAULT_RECURSION_LIMIT;
	}
	const integer = Math.trunc(value);
	if (integer < 10) {
		return 10;
	}
	if (integer > 200) {
		return 200;
	}
	return integer;
}
