import * as vscode from 'vscode';
import { type McpServerEntry, type McpServerSettings, readMcpServerSettings, writeMcpServerSettings } from './config.js';
import { resolveMcpEnabled } from '../settings/naviConfig.js';

export class McpSettingsManager {
	private getConfig(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration('navi');
	}

	public async openSettings(): Promise<void> {
		let shouldContinue = true;
		while (shouldContinue) {
			const config = this.getConfig();
			const mcpEnabled = resolveMcpEnabled(config);
			const servers = await this.readValidatedSettingsOrNotify(config);
			if (!servers) {
				return;
			}

			const serverNames = Object.keys(servers);
			const enabledCount = serverNames.filter((name) => servers[name].enabled !== false).length;
			const selection = await vscode.window.showQuickPick(
				[
					{
						label: mcpEnabled ? '$(circle-slash) Disable MCP' : '$(check) Enable MCP',
						description: `Global switch (currently ${mcpEnabled ? 'ON' : 'OFF'})`,
						action: 'toggle_global'
					},
					{
						label: '$(add) Add MCP Server',
						description: 'Add a new server with stdio/http config',
						action: 'add_server'
					},
					{
						label: '$(settings-gear) Toggle Server Enabled',
						description: `${enabledCount}/${serverNames.length} enabled`,
						action: 'toggle_server',
						disabled: serverNames.length === 0
					},
					{
						label: '$(edit) Edit MCP Server',
						description: serverNames.length === 0 ? 'No servers configured' : 'Update name or connection config',
						action: 'edit_server',
						disabled: serverNames.length === 0
					},
					{
						label: '$(trash) Delete MCP Server',
						description: serverNames.length === 0 ? 'No servers configured' : `${serverNames.length} configured`,
						action: 'delete_server',
						disabled: serverNames.length === 0
					}
				].filter((item) => !item.disabled),
				{
					placeHolder: `MCP Settings (${serverNames.length} servers configured)`
				}
			);

			if (!selection) {
				return;
			}

			if (selection.action === 'toggle_global') {
				await config.update('mcpEnabled', !mcpEnabled, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage(`MCP ${!mcpEnabled ? 'enabled' : 'disabled'}.`);
				continue;
			}

			if (selection.action === 'add_server') {
				const added = await this.addServer(servers);
				if (added) {
					await writeMcpServerSettings(config, servers);
					vscode.window.showInformationMessage(`MCP server "${added}" added.`);
				}
				continue;
			}

			if (selection.action === 'toggle_server') {
				const changed = await this.toggleServerEnabled(servers);
				if (changed) {
					await writeMcpServerSettings(config, servers);
					vscode.window.showInformationMessage(`MCP server "${changed}" status toggled.`);
				}
				continue;
			}

			if (selection.action === 'edit_server') {
				const edited = await this.editServer(servers);
				if (edited) {
					await writeMcpServerSettings(config, servers);
					vscode.window.showInformationMessage(`MCP server "${edited}" updated.`);
				}
				continue;
			}

			if (selection.action === 'delete_server') {
				const removed = await this.deleteServer(servers);
				if (removed) {
					await writeMcpServerSettings(config, servers);
					vscode.window.showInformationMessage(`MCP server "${removed}" deleted.`);
				}
				continue;
			}

			shouldContinue = false;
		}
	}

	private async readValidatedSettingsOrNotify(
		config: vscode.WorkspaceConfiguration
	): Promise<McpServerSettings | undefined> {
		try {
			return await readMcpServerSettings(config);
		} catch (error) {
			const detail = error instanceof Error ? error.message : 'Parsing failed';
			vscode.window.showErrorMessage(`Invalid MCP configuration: ${detail}`);
			return undefined;
		}
	}

	private async addServer(servers: McpServerSettings): Promise<string | undefined> {
		const name = await vscode.window.showInputBox({
			prompt: 'Enter the MCP server name (must be unique)',
			placeHolder: 'e.g. math',
			validateInput: (value) => {
				const trimmed = value.trim();
				if (!trimmed) {
					return 'Name cannot be empty.';
				}
				if (servers[trimmed]) {
					return 'This name already exists.';
				}
				return undefined;
			}
		});
		if (!name) {
			return undefined;
		}

		const serverName = name.trim();
		const transportChoice = await vscode.window.showQuickPick(
			[
				{ label: 'stdio', description: 'Local process via command/args', value: 'stdio' },
				{ label: 'http', description: 'Remote MCP endpoint', value: 'http' }
			],
			{ placeHolder: `Select the transport for "${serverName}"` }
		);
		if (!transportChoice) {
			return undefined;
		}

		if (transportChoice.value === 'stdio') {
			const command = await vscode.window.showInputBox({
				prompt: `Enter the launch command for "${serverName}"`,
				placeHolder: 'e.g. npx',
				validateInput: (value) => (!value.trim() ? 'Command cannot be empty.' : undefined)
			});
			if (!command) {
				return undefined;
			}

			const argsInput = await vscode.window.showInputBox({
				prompt: 'Enter command arguments in JSON array format',
				placeHolder: 'e.g. ["-y","@modelcontextprotocol/server-math"]',
				value: '[]',
				validateInput: (value) => {
					try {
						const parsed = JSON.parse(value);
						if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
							return 'Must be a JSON array of strings.';
						}
						return undefined;
					} catch {
						return 'Please enter valid JSON.';
					}
				}
			});
			if (!argsInput) {
				return undefined;
			}

			const cwd = await vscode.window.showInputBox({
				prompt: 'Optional: enter the working directory (leave blank to skip)',
				placeHolder: 'e.g. E:\\navi'
			});
			const args = JSON.parse(argsInput) as string[];
			const nextServer: McpServerEntry = {
				enabled: true,
				type: 'stdio',
				command: command.trim(),
				args,
				tools: ['*']
			};
			if (cwd && cwd.trim()) {
				nextServer.cwd = cwd.trim();
			}
			servers[serverName] = nextServer;
			return serverName;
		}

		const url = await vscode.window.showInputBox({
			prompt: `Enter the MCP URL for "${serverName}"`,
			placeHolder: 'e.g. https://example.com/mcp',
			validateInput: (value) => {
				try {
					if (!value.trim()) {
						return 'URL cannot be empty.';
					}
					new URL(value.trim());
					return undefined;
				} catch {
					return 'Please enter a valid URL.';
				}
			}
		});
		if (!url) {
			return undefined;
		}

		servers[serverName] = {
			enabled: true,
			type: 'http',
			url: url.trim(),
			tools: ['*']
		};
		return serverName;
	}

	private async toggleServerEnabled(servers: McpServerSettings): Promise<string | undefined> {
		const names = Object.keys(servers);
		if (names.length === 0) {
			return undefined;
		}

		const selected = await vscode.window.showQuickPick(
			names.map((name) => ({
				label: name,
				description: servers[name].enabled === false ? 'Disabled' : 'Enabled'
			})),
			{ placeHolder: 'Select the MCP server to enable/disable' }
		);
		if (!selected) {
			return undefined;
		}

		const current = servers[selected.label];
		current.enabled = current.enabled === false;
		servers[selected.label] = current;
		return selected.label;
	}

	private async deleteServer(servers: McpServerSettings): Promise<string | undefined> {
		const names = Object.keys(servers);
		if (names.length === 0) {
			return undefined;
		}

		const selected = await vscode.window.showQuickPick(
			names.map((name) => ({
				label: name,
				description: servers[name].enabled === false ? 'Disabled' : 'Enabled'
			})),
			{ placeHolder: 'Select the MCP server to delete' }
		);
		if (!selected) {
			return undefined;
		}

		const confirm = await vscode.window.showWarningMessage(
			`Delete MCP server "${selected.label}"?`,
			{ modal: true },
			'Delete'
		);
		if (confirm !== 'Delete') {
			return undefined;
		}

		delete servers[selected.label];
		return selected.label;
	}

	private async editServer(servers: McpServerSettings): Promise<string | undefined> {
		const names = Object.keys(servers);
		if (names.length === 0) {
			return undefined;
		}

		const selected = await vscode.window.showQuickPick(
			names.map((name) => ({
				label: name,
				description: servers[name].enabled === false ? 'Disabled' : 'Enabled'
			})),
			{ placeHolder: 'Select the MCP server to edit' }
		);
		if (!selected) {
			return undefined;
		}

		const originalName = selected.label;
		const original = servers[originalName];
		const renamedInput = await vscode.window.showInputBox({
			prompt: 'Edit the server name',
			value: originalName,
			validateInput: (value) => {
				const trimmed = value.trim();
				if (!trimmed) {
					return 'Name cannot be empty.';
				}
				if (trimmed !== originalName && servers[trimmed]) {
					return 'This name already exists.';
				}
				return undefined;
			}
		});
		if (!renamedInput) {
			return undefined;
		}

		const nextName = renamedInput.trim();
		const currentTransport = typeof original.type === 'string' ? original.type : 'stdio';
		const transportChoice = await vscode.window.showQuickPick(
			[
				{ label: 'stdio', description: 'Local process via command/args', value: 'stdio' },
				{ label: 'http', description: 'Remote MCP endpoint', value: 'http' }
			],
			{
				placeHolder: `Select the transport for "${nextName}"`,
				title: `Current: ${currentTransport}`
			}
		);
		if (!transportChoice) {
			return undefined;
		}

		let nextServer: McpServerEntry;
		if (transportChoice.value === 'stdio') {
			const defaultCommand = typeof original.command === 'string' ? original.command : 'npx';
			const command = await vscode.window.showInputBox({
				prompt: `Enter the launch command for "${nextName}"`,
				value: defaultCommand,
				validateInput: (value) => (!value.trim() ? 'Command cannot be empty.' : undefined)
			});
			if (!command) {
				return undefined;
			}

			const defaultArgs = Array.isArray(original.args) ? JSON.stringify(original.args) : '[]';
			const argsInput = await vscode.window.showInputBox({
				prompt: 'Enter command arguments in JSON array format',
				value: defaultArgs,
				validateInput: (value) => {
					try {
						const parsed = JSON.parse(value);
						if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
							return 'Must be a JSON array of strings.';
						}
						return undefined;
					} catch {
						return 'Please enter valid JSON.';
					}
				}
			});
			if (!argsInput) {
				return undefined;
			}

			const defaultCwd = typeof original.cwd === 'string' ? original.cwd : '';
			const cwd = await vscode.window.showInputBox({
				prompt: 'Optional: enter the working directory (leave blank to skip)',
				value: defaultCwd
			});
			const args = JSON.parse(argsInput) as string[];
			nextServer = {
				...original,
				type: 'stdio',
				command: command.trim(),
				args,
				tools: original.tools ?? ['*']
			};
			delete nextServer.url;
			if (cwd && cwd.trim()) {
				nextServer.cwd = cwd.trim();
			} else {
				delete nextServer.cwd;
			}
		} else {
			const defaultUrl = typeof original.url === 'string' ? original.url : 'https://';
			const url = await vscode.window.showInputBox({
				prompt: `Enter the MCP URL for "${nextName}"`,
				value: defaultUrl,
				validateInput: (value) => {
					try {
						if (!value.trim()) {
							return 'URL cannot be empty.';
						}
						new URL(value.trim());
						return undefined;
					} catch {
						return 'Please enter a valid URL.';
					}
				}
			});
			if (!url) {
				return undefined;
			}

			nextServer = {
				...original,
				type: 'http',
				url: url.trim(),
				tools: original.tools ?? ['*']
			};
			delete nextServer.command;
			delete nextServer.args;
			delete nextServer.cwd;
		}

		delete servers[originalName];
		servers[nextName] = nextServer;
		return nextName;
	}
}
