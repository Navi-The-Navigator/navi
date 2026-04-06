import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { CopilotClient } from '@github/copilot-sdk';
import type { CopilotClientOptions, SessionConfig } from '@github/copilot-sdk';

const cliDebugOutput = vscode.window.createOutputChannel('Navi Copilot CLI');
let hasShownCliPathWarning = false;

export type AuthMode = 'copilot' | 'byok';

export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_MODEL = 'gpt-4.1';
export const DEFAULT_RECURSION_LIMIT = 150;
export const DEFAULT_STREAMING_ENABLED = true;

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
	const debugCliArgs = config.get<boolean>('debugCopilotCliArgs', false);
	const configuredCliPathRaw = (config.get<string>('copilotCliPath') ?? '').trim();
	const configuredCliPath = configuredCliPathRaw && existsSync(configuredCliPathRaw) ? configuredCliPathRaw : undefined;
	const resolvedCli = resolveNativeCopilotCliPathInVsCodeHost(debugCliArgs);
	const cliPath = configuredCliPath ?? resolvedCli.path;
	if (debugCliArgs && configuredCliPathRaw && !configuredCliPath) {
		cliDebugOutput.appendLine(`[resolve-cli] Ignoring invalid navi.copilotCliPath: ${configuredCliPathRaw}`);
	}
	if (!configuredCliPath && !cliPath) {
		maybeWarnCliPathNotResolved(resolvedCli.tried);
	}

	if (authMode === 'copilot') {
		const githubToken = await acquireGitHubToken();
		const options: CopilotClientOptions = {
			cliPath,
			useLoggedInUser: !githubToken,
			githubToken,
			logLevel: 'error'
		};
		const client = new CopilotClient(options);
		if (debugCliArgs) {
			logCopilotCliLaunch(client, options);
		}
		return client;
	}

	// BYOK – no GitHub auth required
	const options: CopilotClientOptions = {
		cliPath,
		useLoggedInUser: false,
		logLevel: 'error'
	};
	const client = new CopilotClient(options);
	if (debugCliArgs) {
		logCopilotCliLaunch(client, options);
	}
	return client;
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

export function resolveStreaming(config: vscode.WorkspaceConfiguration): boolean {
	return config.get<boolean>('streaming', DEFAULT_STREAMING_ENABLED);
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

type RuntimeClientOptions = {
	cliPath?: string;
	cliArgs?: string[];
	useStdio?: boolean;
	port?: number;
	logLevel?: string;
	githubToken?: string;
	useLoggedInUser?: boolean;
};

function logCopilotCliLaunch(client: CopilotClient, requestedOptions: CopilotClientOptions): void {
	const runtimeOptions = ((client as unknown as { options?: RuntimeClientOptions }).options ?? {}) as RuntimeClientOptions;
	const cliPath = runtimeOptions.cliPath ?? requestedOptions.cliPath ?? '<unknown-cli-path>';
	const cliArgs = Array.isArray(runtimeOptions.cliArgs) ? runtimeOptions.cliArgs : (requestedOptions.cliArgs ?? []);
	const logLevel = runtimeOptions.logLevel ?? requestedOptions.logLevel ?? 'debug';
	const useStdio = runtimeOptions.useStdio ?? (requestedOptions.useStdio ?? true);
	const port = runtimeOptions.port ?? requestedOptions.port ?? 0;
	const hasGitHubToken = Boolean(runtimeOptions.githubToken ?? requestedOptions.githubToken);
	const useLoggedInUser = runtimeOptions.useLoggedInUser ?? requestedOptions.useLoggedInUser ?? true;

	const sdkManagedArgs: string[] = [
		'--headless',
		'--no-auto-update',
		'--log-level',
		logLevel
	];

	if (useStdio) {
		sdkManagedArgs.push('--stdio');
	} else if (port > 0) {
		sdkManagedArgs.push('--port', String(port));
	}
	if (hasGitHubToken) {
		sdkManagedArgs.push('--auth-token-env', 'COPILOT_SDK_AUTH_TOKEN');
	}
	if (!useLoggedInUser) {
		sdkManagedArgs.push('--no-auto-login');
	}

	const argv = [...cliArgs, ...sdkManagedArgs];
	const commandParts = cliPath.endsWith('.js')
		? [process.execPath, cliPath, ...argv]
		: [cliPath, ...argv];

	const formatArg = (value: string): string => {
		if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
			return value;
		}
		return JSON.stringify(value);
	};

	cliDebugOutput.appendLine(`[${new Date().toISOString()}] Copilot CLI launch preview`);
	cliDebugOutput.appendLine(`cliPath: ${cliPath}`);
	cliDebugOutput.appendLine(`process.execPath: ${process.execPath}`);
	cliDebugOutput.appendLine(`argv(json): ${JSON.stringify(argv)}`);
	cliDebugOutput.appendLine(`command(pretty): ${commandParts.map(formatArg).join(' ')}`);
	cliDebugOutput.appendLine(
		`auth: hasGithubToken=${hasGitHubToken}, useLoggedInUser=${useLoggedInUser}`
	);
	cliDebugOutput.appendLine('---');
	cliDebugOutput.show(true);
}

function resolveNativeCopilotCliPathInVsCodeHost(debug: boolean): { path?: string; tried: string[] } {
	// In VS Code extension hosts, process.execPath is often Code.exe, which cannot run JS entry files as Node.
	const isVsCodeHost = /code( - insiders)?\.exe$/i.test(process.execPath);
	const tried: string[] = [];
	if (!isVsCodeHost) {
		if (debug) {
			cliDebugOutput.appendLine('[resolve-cli] Skip native CLI probe: not in VS Code host process');
		}
		return { path: undefined, tried };
	}

	const packageByPlatform: Record<string, string> = {
		'win32:x64': '@github/copilot-win32-x64',
		'win32:arm64': '@github/copilot-win32-arm64',
		'darwin:x64': '@github/copilot-darwin-x64',
		'darwin:arm64': '@github/copilot-darwin-arm64',
		'linux:x64': '@github/copilot-linux-x64',
		'linux:arm64': '@github/copilot-linux-arm64'
	};

	const key = `${process.platform}:${process.arch}`;
	const packageName = packageByPlatform[key];
	if (!packageName) {
		if (debug) {
			cliDebugOutput.appendLine(`[resolve-cli] Unsupported platform/arch: ${key}`);
		}
		return { path: undefined, tried };
	}

	const binName = process.platform === 'win32' ? 'copilot.exe' : 'copilot';

	// 1) Prefer Navi extension's own node_modules by walking up from current module location.
	let dir = __dirname;
	for (let i = 0; i < 8; i += 1) {
		const candidate = join(dir, 'node_modules', ...packageName.split('/'), binName);
		tried.push(candidate);
		if (existsSync(candidate)) {
			if (debug) {
				cliDebugOutput.appendLine(`[resolve-cli] Resolved from extension-local node_modules: ${candidate}`);
			}
			return { path: candidate, tried };
		}
		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}

	// 2) Resolve relative to @github/copilot-sdk package location (same scope folder sibling).
	try {
		const requireFn = createRequire(__filename);
		const copilotSdkEntry = requireFn.resolve('@github/copilot-sdk');
		const copilotSdkPackageDir = findPackageDir(copilotSdkEntry);
		const scopeDir = dirname(copilotSdkPackageDir);
		const sibling = join(scopeDir, packageName.split('/')[1], binName);
		tried.push(sibling);
		if (existsSync(sibling)) {
			if (debug) {
				cliDebugOutput.appendLine(`[resolve-cli] Resolved via @github/copilot-sdk sibling package: ${sibling}`);
			}
			return { path: sibling, tried };
		}
	} catch {
		// continue probing
	}

	if (debug) {
		cliDebugOutput.appendLine(`[resolve-cli] Failed to resolve native CLI (${packageName}/${binName}).`);
		cliDebugOutput.appendLine('[resolve-cli] Auto probe failed; user can set navi.copilotCliPath.');
		for (const candidate of tried) {
			cliDebugOutput.appendLine(`[resolve-cli] tried: ${candidate}`);
		}
	}

	return { path: undefined, tried };
}

function findPackageDir(resolvedEntryPath: string): string {
	let dir = dirname(resolvedEntryPath);
	for (let i = 0; i < 8; i += 1) {
		if (existsSync(join(dir, 'package.json'))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	throw new Error(`Unable to locate package.json for resolved entry: ${resolvedEntryPath}`);
}

function maybeWarnCliPathNotResolved(tried: string[]): void {
	if (hasShownCliPathWarning) {
		return;
	}
	hasShownCliPathWarning = true;

	void vscode.window.showWarningMessage(
		'未能自动定位 Copilot CLI 可执行文件。请在设置中配置 navi.copilotCliPath（例如 node_modules/@github/copilot-win32-x64/copilot.exe）。'
	);
	cliDebugOutput.appendLine('[resolve-cli] WARNING: auto resolution failed. Please set navi.copilotCliPath.');
	for (const candidate of tried) {
		cliDebugOutput.appendLine(`[resolve-cli] tried: ${candidate}`);
	}
}
