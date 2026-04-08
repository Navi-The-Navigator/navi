import * as vscode from 'vscode';
import { McpSettingsManager } from '../mcp/settingsManager.js';

const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-5-mini';

export class SettingsManager {
	private readonly mcpSettingsManager = new McpSettingsManager();

	public async openSettings(): Promise<void> {
		const config = vscode.workspace.getConfiguration('navi');
		const authMode = this.getAuthMode(config);
		const authLabel = authMode === 'copilot' ? 'GitHub Copilot' : 'BYOK';

		let llmDescription: string;
		if (authMode === 'copilot') {
			const model = this.getConfiguredModel(config);
			llmDescription = `Auth: ${authLabel} | Model: ${model}`;
		} else {
			const keySource = this.describeKeySource(config);
			const baseUrl = this.getConfiguredBaseUrl(config);
			const model = this.getConfiguredModel(config);
			llmDescription = `Auth: ${authLabel} | Key: ${keySource} | Endpoint: ${baseUrl} | Model: ${model}`;
		}

		const selection = await vscode.window.showQuickPick(
			[
				{
					label: '$(hubot) LLM Settings',
					description: llmDescription,
					action: 'llm'
				},
				{
					label: '$(tools) MCP Settings',
					description: 'Add/Edit/Delete/Enable/Disable MCP servers',
					action: 'mcp'
				}
			],
			{ placeHolder: 'Settings' }
		);

		if (!selection) {
			return;
		}

		if (selection.action === 'llm') {
			await this.openLlmSettings();
			return;
		}

		if (selection.action === 'mcp') {
			await this.mcpSettingsManager.openSettings();
		}
	}

	public async openLlmSettings(): Promise<void> {
		const config = vscode.workspace.getConfiguration('navi');
		const authMode = this.getAuthMode(config);
		const authLabel = authMode === 'copilot' ? 'GitHub Copilot' : 'BYOK';

		const items: Array<{ label: string; description: string; action: string }> = [
			{
				label: '$(shield) Auth Mode',
				description: authLabel,
				action: 'auth_mode'
			}
		];

		if (authMode === 'byok') {
			const keySource = this.describeKeySource(config);
			const baseUrl = this.getConfiguredBaseUrl(config);
			items.push(
				{
					label: '$(key) API Key',
					description: keySource,
					action: 'api_key'
				},
				{
					label: '$(link-external) API Endpoint',
					description: baseUrl,
					action: 'endpoint'
				}
			);
		}

		items.push({
			label: '$(symbol-field) Model Name',
			description: this.getConfiguredModel(config),
			action: 'model'
		});

		const selection = await vscode.window.showQuickPick(items, {
			placeHolder: 'LLM Settings'
		});

		if (!selection) {
			return;
		}

		switch (selection.action) {
			case 'auth_mode':
				await this.openAuthModeSettings();
				break;
			case 'api_key':
				await this.openApiKeySettings();
				break;
			case 'endpoint':
				await this.openBaseUrlSettings();
				break;
			case 'model':
				await this.openModelSettings();
				break;
		}
	}

	public async openAuthModeSettings(): Promise<void> {
		const config = vscode.workspace.getConfiguration('navi');
		const current = this.getAuthMode(config);

		const selection = await vscode.window.showQuickPick(
			[
				{
					label: '$(github) GitHub Copilot',
					description: current === 'copilot' ? '(current)' : '',
					action: 'copilot' as const
				},
				{
					label: '$(key) Bring Your Own Key (BYOK)',
					description: current === 'byok' ? '(current)' : '',
					action: 'byok' as const
				}
			],
			{ placeHolder: 'Select authentication mode' }
		);

		if (!selection || selection.action === current) {
			return;
		}

		await config.update('authMode', selection.action, vscode.ConfigurationTarget.Global);

		if (selection.action === 'copilot') {
			vscode.window.showInformationMessage('已切换到 GitHub Copilot 模式。将使用 Copilot 订阅进行认证。');
		} else {
			vscode.window.showInformationMessage('已切换到 BYOK 模式。请配置 API Key 和 Endpoint。');
			await this.openApiKeySettings();
		}
	}

	public async openApiKeySettings(): Promise<void> {
		const config = vscode.workspace.getConfiguration('navi');
		const configuredApiKey = this.getConfiguredApiKey(config);
		const envApiKey = this.getEnvApiKey();
		const keySource = this.describeKeySource(config);

		const selection = await vscode.window.showQuickPick(
			[
				{
					label: configuredApiKey ? '$(edit) Update API Key' : '$(add) Set API Key',
					description: 'Store key in VS Code Settings (takes precedence over environment variable)',
					action: 'set'
				},
				{
					label: '$(trash) Clear API Key in VS Code Settings',
					description: configuredApiKey ? 'After clearing, env var will be used if available' : 'No key stored in settings',
					action: 'clear'
				}
			],
			{
				placeHolder: `API Key Settings (current: ${keySource})`
			}
		);

		if (!selection) {
			return;
		}

		if (selection.action === 'set') {
			const input = await vscode.window.showInputBox({
				prompt: 'Enter API Key',
				placeHolder: 'sk-...',
				password: true,
				ignoreFocusOut: true,
				validateInput: (value) => (!value.trim() ? 'API Key cannot be empty.' : undefined)
			});
			if (!input) {
				return;
			}

			await config.update('apiKey', input.trim(), vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage('API Key 已保存。后续会优先使用 VS Code Settings 中的 Key。');
			return;
		}

		if (selection.action === 'clear') {
			await config.update('apiKey', '', vscode.ConfigurationTarget.Global);
			if (envApiKey) {
				vscode.window.showInformationMessage('已清除 VS Code 中的 API Key。当前会回退到环境变量。');
			} else {
				vscode.window.showInformationMessage('已清除 VS Code 中的 API Key。当前未检测到可用 API Key。');
			}
		}
	}

	public async openBaseUrlSettings(): Promise<void> {
		const config = vscode.workspace.getConfiguration('navi');
		const configuredBaseUrl = this.getConfiguredBaseUrl(config);

		const selection = await vscode.window.showQuickPick(
			[
				{
					label: '$(edit) Update API Endpoint',
					description: configuredBaseUrl,
					action: 'set'
				},
				{
					label: '$(discard) Reset to Default Endpoint',
					description: DEFAULT_API_BASE_URL,
					action: 'reset'
				}
			],
			{
				placeHolder: 'API Endpoint Settings'
			}
		);

		if (!selection) {
			return;
		}

		if (selection.action === 'set') {
			const input = await vscode.window.showInputBox({
				prompt: 'Enter OpenAI-compatible API base URL',
				placeHolder: DEFAULT_API_BASE_URL,
				value: configuredBaseUrl,
				ignoreFocusOut: true,
				validateInput: (value) => this.validateBaseUrl(value)
			});
			if (!input) {
				return;
			}

			await config.update('apiBaseUrl', input.trim(), vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`LLM API 端点已更新为 ${input.trim()}。`);
			return;
		}

		if (selection.action === 'reset') {
			await config.update('apiBaseUrl', DEFAULT_API_BASE_URL, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`LLM API 端点已重置为默认值 ${DEFAULT_API_BASE_URL}。`);
		}
	}

	public async openModelSettings(): Promise<void> {
		const config = vscode.workspace.getConfiguration('navi');
		const configuredModel = this.getConfiguredModel(config);

		const selection = await vscode.window.showQuickPick(
			[
				{
					label: '$(edit) Update Model Name',
					description: configuredModel,
					action: 'set'
				},
				{
					label: '$(discard) Reset to Default Model',
					description: DEFAULT_MODEL,
					action: 'reset'
				}
			],
			{
				placeHolder: 'Model Settings'
			}
		);

		if (!selection) {
			return;
		}

		if (selection.action === 'set') {
			const input = await vscode.window.showInputBox({
				prompt: 'Enter model name',
				placeHolder: DEFAULT_MODEL,
				value: configuredModel,
				ignoreFocusOut: true,
				validateInput: (value) => (!value.trim() ? 'Model name cannot be empty.' : undefined)
			});
			if (!input) {
				return;
			}

			await config.update('model', input.trim(), vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`LLM 模型已更新为 ${input.trim()}。`);
			return;
		}

		if (selection.action === 'reset') {
			await config.update('model', DEFAULT_MODEL, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`LLM 模型已重置为默认值 ${DEFAULT_MODEL}。`);
		}
	}

	private getAuthMode(config: vscode.WorkspaceConfiguration): string {
		return (config.get<string>('authMode') ?? 'copilot').trim().toLowerCase();
	}

	private getConfiguredApiKey(config: vscode.WorkspaceConfiguration): string {
		return (config.get<string>('apiKey') ?? '').trim();
	}

	private getEnvApiKey(): string {
		return (process.env.NAVI_API_KEY ?? '').trim();
	}

	private describeKeySource(config: vscode.WorkspaceConfiguration): string {
		const configuredApiKey = this.getConfiguredApiKey(config);
		const envApiKey = this.getEnvApiKey();
		return configuredApiKey
			? 'VS Code Settings (in use)'
			: envApiKey
				? 'Environment variable (in use)'
				: 'Not configured';
	}

	private getConfiguredBaseUrl(config: vscode.WorkspaceConfiguration): string {
		const value = (config.get<string>('apiBaseUrl', DEFAULT_API_BASE_URL) ?? DEFAULT_API_BASE_URL).trim();
		return value || DEFAULT_API_BASE_URL;
	}

	private getConfiguredModel(config: vscode.WorkspaceConfiguration): string {
		const value = (config.get<string>('model', DEFAULT_MODEL) ?? DEFAULT_MODEL).trim();
		return value || DEFAULT_MODEL;
	}

	private validateBaseUrl(value: string): string | undefined {
		const trimmed = value.trim();
		if (!trimmed) {
			return 'API endpoint cannot be empty.';
		}

		try {
			const url = new URL(trimmed);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				return 'API endpoint must use http or https.';
			}
			return undefined;
		} catch {
			return 'Please enter a valid URL.';
		}
	}
}
