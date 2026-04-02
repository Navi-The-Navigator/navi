import * as vscode from 'vscode';
import { McpSettingsManager } from '../mcp/settingsManager';

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-reasoner';

export class SettingsManager {
	private readonly mcpSettingsManager = new McpSettingsManager();

	public async openSettings(): Promise<void> {
		const config = vscode.workspace.getConfiguration('navi');
		const configuredApiKey = (config.get<string>('deepseekApiKey') ?? '').trim();
		const configuredBaseUrl = this.getConfiguredBaseUrl(config);
		const configuredModel = this.getConfiguredModel(config);
		const envApiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
		const keySource = configuredApiKey
			? 'VS Code Settings (overrides env)'
			: envApiKey
				? 'Environment variable'
				: 'Not configured';

		const selection = await vscode.window.showQuickPick(
			[
				{
					label: '$(hubot) LLM Settings',
					description: `Key: ${keySource} | Endpoint: ${configuredBaseUrl} | Model: ${configuredModel}`,
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
		const configuredApiKey = (config.get<string>('deepseekApiKey') ?? '').trim();
		const configuredBaseUrl = this.getConfiguredBaseUrl(config);
		const configuredModel = this.getConfiguredModel(config);
		const envApiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
		const keySource = configuredApiKey
			? 'VS Code Settings (in use)'
			: envApiKey
				? 'Environment variable (in use)'
				: 'Not configured';

		const selection = await vscode.window.showQuickPick(
			[
				{
					label: '$(key) API Key',
					description: keySource,
					action: 'api_key'
				},
				{
					label: '$(link-external) API Endpoint',
					description: configuredBaseUrl,
					action: 'endpoint'
				},
				{
					label: '$(symbol-field) Model Name',
					description: configuredModel,
					action: 'model'
				}
			],
			{
				placeHolder: 'LLM Settings'
			}
		);

		if (!selection) {
			return;
		}

		if (selection.action === 'api_key') {
			await this.openApiKeySettings();
			return;
		}

		if (selection.action === 'endpoint') {
			await this.openBaseUrlSettings();
			return;
		}

		if (selection.action === 'model') {
			await this.openModelSettings();
		}
	}

	public async openApiKeySettings(): Promise<void> {
		const config = vscode.workspace.getConfiguration('navi');
		const configuredApiKey = (config.get<string>('deepseekApiKey') ?? '').trim();
		const envApiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
		const keySource = configuredApiKey
			? 'VS Code Settings (in use)'
			: envApiKey
				? 'Environment variable (in use)'
				: 'Not configured';

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
				prompt: 'Enter DeepSeek API Key',
				placeHolder: 'sk-...',
				password: true,
				ignoreFocusOut: true,
				validateInput: (value) => (!value.trim() ? 'API Key cannot be empty.' : undefined)
			});
			if (!input) {
				return;
			}

			await config.update('deepseekApiKey', input.trim(), vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage('API Key 已保存。后续会优先使用 VS Code Settings 中的 Key。');
			return;
		}

		if (selection.action === 'clear') {
			await config.update('deepseekApiKey', '', vscode.ConfigurationTarget.Global);
			if (envApiKey) {
				vscode.window.showInformationMessage('已清除 VS Code 中的 API Key。当前会回退到环境变量 DEEPSEEK_API_KEY。');
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
					description: DEFAULT_DEEPSEEK_BASE_URL,
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
				placeHolder: DEFAULT_DEEPSEEK_BASE_URL,
				value: configuredBaseUrl,
				ignoreFocusOut: true,
				validateInput: (value) => this.validateBaseUrl(value)
			});
			if (!input) {
				return;
			}

			await config.update('deepseekBaseUrl', input.trim(), vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`LLM API 端点已更新为 ${input.trim()}。`);
			return;
		}

		if (selection.action === 'reset') {
			await config.update('deepseekBaseUrl', DEFAULT_DEEPSEEK_BASE_URL, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`LLM API 端点已重置为默认值 ${DEFAULT_DEEPSEEK_BASE_URL}。`);
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
					description: DEFAULT_DEEPSEEK_MODEL,
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
				placeHolder: DEFAULT_DEEPSEEK_MODEL,
				value: configuredModel,
				ignoreFocusOut: true,
				validateInput: (value) => (!value.trim() ? 'Model name cannot be empty.' : undefined)
			});
			if (!input) {
				return;
			}

			await config.update('deepseekModel', input.trim(), vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`LLM 模型已更新为 ${input.trim()}。`);
			return;
		}

		if (selection.action === 'reset') {
			await config.update('deepseekModel', DEFAULT_DEEPSEEK_MODEL, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`LLM 模型已重置为默认值 ${DEFAULT_DEEPSEEK_MODEL}。`);
		}
	}

	private getConfiguredBaseUrl(config: vscode.WorkspaceConfiguration): string {
		const value = (config.get<string>('deepseekBaseUrl', DEFAULT_DEEPSEEK_BASE_URL) ?? DEFAULT_DEEPSEEK_BASE_URL).trim();
		return value || DEFAULT_DEEPSEEK_BASE_URL;
	}

	private getConfiguredModel(config: vscode.WorkspaceConfiguration): string {
		const value = (config.get<string>('deepseekModel', DEFAULT_DEEPSEEK_MODEL) ?? DEFAULT_DEEPSEEK_MODEL).trim();
		return value || DEFAULT_DEEPSEEK_MODEL;
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
