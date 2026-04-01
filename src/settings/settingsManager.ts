import * as vscode from 'vscode';
import { McpSettingsManager } from '../mcp/settingsManager';

export class SettingsManager {
	private readonly mcpSettingsManager = new McpSettingsManager();

	public async openSettings(): Promise<void> {
		const config = vscode.workspace.getConfiguration('navi');
		const configuredApiKey = (config.get<string>('deepseekApiKey') ?? '').trim();
		const envApiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
		const keySource = configuredApiKey
			? 'VS Code Settings (overrides env)'
			: envApiKey
				? 'Environment variable'
				: 'Not configured';

		const selection = await vscode.window.showQuickPick(
			[
				{
					label: '$(key) API Key Settings',
					description: `Current source: ${keySource}`,
					action: 'api_key'
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

		if (selection.action === 'api_key') {
			await this.openApiKeySettings();
			return;
		}

		if (selection.action === 'mcp') {
			await this.mcpSettingsManager.openSettings();
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
}
