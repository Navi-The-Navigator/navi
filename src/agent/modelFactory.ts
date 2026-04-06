import * as vscode from 'vscode';
import { CopilotClient } from '@github/copilot-sdk';
import type { CopilotClientOptions, SessionConfig } from '@github/copilot-sdk';

export type AuthMode = 'copilot' | 'byok';

export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_MODEL = 'gpt-4.1';
export const DEFAULT_RECURSION_LIMIT = 150;

/**
 * Create a {@link CopilotClient}.
 *
 * - **copilot** mode: `useLoggedInUser: true` + optional `githubToken`
 *   obtained from `vscode.authentication`.
 * - **byok** mode: `useLoggedInUser: false`; BYOK credentials are
 *   passed at session-creation time via {@link resolveProvider}.
 */
export async function createCopilotClient(
	config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('navi')
): Promise<CopilotClient> {
	const authMode = resolveAuthMode(config);

	if (authMode === 'copilot') {
		const githubToken = await acquireGitHubToken();
		const options: CopilotClientOptions = {
			useLoggedInUser: !githubToken,
			githubToken,
			logLevel: 'error'
		};
		return new CopilotClient(options);
	}

	// BYOK – no GitHub auth required
	const options: CopilotClientOptions = {
		useLoggedInUser: false,
		logLevel: 'error'
	};
	return new CopilotClient(options);
}

/**
 * Build the BYOK provider config for session creation.
 * Returns `undefined` in copilot mode (the SDK uses Copilot's own endpoint).
 */
export function resolveProvider(
	config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('navi')
): SessionConfig['provider'] | undefined {
	const authMode = resolveAuthMode(config);
	if (authMode === 'copilot') {
		return undefined;
	}

	const apiKey = resolveApiKey(config);
	if (!apiKey) {
		throw new Error('缺少 API Key。请先通过 Settings 配置 navi.apiKey，或设置环境变量 NAVI_API_KEY。');
	}

	return {
		type: 'openai',
		baseUrl: resolveBaseUrl(config),
		apiKey
	};
}

export function resolveAuthMode(config: vscode.WorkspaceConfiguration): AuthMode {
	const value = (config.get<string>('authMode') ?? 'copilot').trim().toLowerCase();
	return value === 'byok' ? 'byok' : 'copilot';
}

export function resolveApiKey(config: vscode.WorkspaceConfiguration): string {
	const configuredApiKey = (config.get<string>('apiKey') ?? '').trim();
	if (configuredApiKey) {
		return configuredApiKey;
	}

	return (process.env.NAVI_API_KEY ?? '').trim();
}

export function resolveBaseUrl(config: vscode.WorkspaceConfiguration): string {
	const configuredBaseUrl = (config.get<string>('apiBaseUrl', DEFAULT_API_BASE_URL) ?? '').trim();
	return configuredBaseUrl || DEFAULT_API_BASE_URL;
}

export function resolveModel(config: vscode.WorkspaceConfiguration): string {
	const configuredModel = (config.get<string>('model', DEFAULT_MODEL) ?? '').trim();
	return configuredModel || DEFAULT_MODEL;
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

/**
 * Try to obtain a GitHub token via the VS Code authentication API.
 * Falls back to `GITHUB_TOKEN` env var.
 * Returns `undefined` when no token is available (the SDK will
 * fall back to `useLoggedInUser` / gh CLI auth).
 */
async function acquireGitHubToken(): Promise<string | undefined> {
	try {
		const session = await vscode.authentication.getSession('github', ['read:user'], {
			createIfNone: false,
			silent: true
		});
		if (session?.accessToken) {
			return session.accessToken;
		}
	} catch {
		// best-effort
	}
	return (process.env.GITHUB_TOKEN ?? '').trim() || undefined;
}
