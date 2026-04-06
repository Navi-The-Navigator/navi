import * as vscode from 'vscode';
import { type McpServerEntry, type McpServerSettings, readMcpServerSettings, writeMcpServerSettings } from './config.js';

export class McpSettingsManager {
	private getConfig(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration('navi');
	}

	public async openSettings(): Promise<void> {
		let shouldContinue = true;
		while (shouldContinue) {
			const config = this.getConfig();
			const mcpEnabled = config.get<boolean>('mcpEnabled', false);
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
				vscode.window.showInformationMessage(`MCP 已${!mcpEnabled ? '启用' : '禁用'}。`);
				continue;
			}

			if (selection.action === 'add_server') {
				const added = await this.addServer(servers);
				if (added) {
					await writeMcpServerSettings(config, servers);
					vscode.window.showInformationMessage(`MCP 服务器 "${added}" 已添加。`);
				}
				continue;
			}

			if (selection.action === 'toggle_server') {
				const changed = await this.toggleServerEnabled(servers);
				if (changed) {
					await writeMcpServerSettings(config, servers);
					vscode.window.showInformationMessage(`MCP 服务器 "${changed}" 状态已切换。`);
				}
				continue;
			}

			if (selection.action === 'edit_server') {
				const edited = await this.editServer(servers);
				if (edited) {
					await writeMcpServerSettings(config, servers);
					vscode.window.showInformationMessage(`MCP 服务器 "${edited}" 已更新。`);
				}
				continue;
			}

			if (selection.action === 'delete_server') {
				const removed = await this.deleteServer(servers);
				if (removed) {
					await writeMcpServerSettings(config, servers);
					vscode.window.showInformationMessage(`MCP 服务器 "${removed}" 已删除。`);
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
			const detail = error instanceof Error ? error.message : '解析失败';
			vscode.window.showErrorMessage(`MCP 配置无效：${detail}`);
			return undefined;
		}
	}

	private async addServer(servers: McpServerSettings): Promise<string | undefined> {
		const name = await vscode.window.showInputBox({
			prompt: '输入 MCP 服务器名称（唯一）',
			placeHolder: '例如: math',
			validateInput: (value) => {
				const trimmed = value.trim();
				if (!trimmed) {
					return '名称不能为空。';
				}
				if (servers[trimmed]) {
					return '该名称已存在。';
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
			{ placeHolder: `选择 "${serverName}" 的传输方式` }
		);
		if (!transportChoice) {
			return undefined;
		}

		if (transportChoice.value === 'stdio') {
			const command = await vscode.window.showInputBox({
				prompt: `输入 "${serverName}" 的启动命令`,
				placeHolder: '例如: npx',
				validateInput: (value) => (!value.trim() ? '命令不能为空。' : undefined)
			});
			if (!command) {
				return undefined;
			}

			const argsInput = await vscode.window.showInputBox({
				prompt: '输入命令参数，使用 JSON 数组格式',
				placeHolder: '例如: ["-y","@modelcontextprotocol/server-math"]',
				value: '[]',
				validateInput: (value) => {
					try {
						const parsed = JSON.parse(value);
						if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
							return '必须是字符串数组 JSON。';
						}
						return undefined;
					} catch {
						return '请输入合法 JSON。';
					}
				}
			});
			if (!argsInput) {
				return undefined;
			}

			const cwd = await vscode.window.showInputBox({
				prompt: '可选：输入工作目录（留空则不设置）',
				placeHolder: '例如: E:\\navi'
			});
			const args = JSON.parse(argsInput) as string[];
			const nextServer: McpServerEntry = {
				enabled: true,
				transport: 'stdio',
				command: command.trim(),
				args
			};
			if (cwd && cwd.trim()) {
				nextServer.cwd = cwd.trim();
			}
			servers[serverName] = nextServer;
			return serverName;
		}

		const url = await vscode.window.showInputBox({
			prompt: `输入 "${serverName}" 的 MCP URL`,
			placeHolder: '例如: https://example.com/mcp',
			validateInput: (value) => {
				try {
					if (!value.trim()) {
						return 'URL 不能为空。';
					}
					new URL(value.trim());
					return undefined;
				} catch {
					return '请输入合法 URL。';
				}
			}
		});
		if (!url) {
			return undefined;
		}

		servers[serverName] = {
			enabled: true,
			transport: 'http',
			url: url.trim()
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
			{ placeHolder: '选择要启用/禁用的 MCP 服务器' }
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
			{ placeHolder: '选择要删除的 MCP 服务器' }
		);
		if (!selected) {
			return undefined;
		}

		const confirm = await vscode.window.showWarningMessage(
			`确定删除 MCP 服务器 "${selected.label}" 吗？`,
			{ modal: true },
			'删除'
		);
		if (confirm !== '删除') {
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
			{ placeHolder: '选择要编辑的 MCP 服务器' }
		);
		if (!selected) {
			return undefined;
		}

		const originalName = selected.label;
		const original = servers[originalName];
		const renamedInput = await vscode.window.showInputBox({
			prompt: '编辑服务器名称',
			value: originalName,
			validateInput: (value) => {
				const trimmed = value.trim();
				if (!trimmed) {
					return '名称不能为空。';
				}
				if (trimmed !== originalName && servers[trimmed]) {
					return '该名称已存在。';
				}
				return undefined;
			}
		});
		if (!renamedInput) {
			return undefined;
		}

		const nextName = renamedInput.trim();
		const currentTransport = typeof original.transport === 'string' ? original.transport : 'stdio';
		const transportChoice = await vscode.window.showQuickPick(
			[
				{ label: 'stdio', description: 'Local process via command/args', value: 'stdio' },
				{ label: 'http', description: 'Remote MCP endpoint', value: 'http' }
			],
			{
				placeHolder: `选择 "${nextName}" 的传输方式`,
				title: `当前：${currentTransport}`
			}
		);
		if (!transportChoice) {
			return undefined;
		}

		let nextServer: McpServerEntry;
		if (transportChoice.value === 'stdio') {
			const defaultCommand = typeof original.command === 'string' ? original.command : 'npx';
			const command = await vscode.window.showInputBox({
				prompt: `输入 "${nextName}" 的启动命令`,
				value: defaultCommand,
				validateInput: (value) => (!value.trim() ? '命令不能为空。' : undefined)
			});
			if (!command) {
				return undefined;
			}

			const defaultArgs = Array.isArray(original.args) ? JSON.stringify(original.args) : '[]';
			const argsInput = await vscode.window.showInputBox({
				prompt: '输入命令参数，使用 JSON 数组格式',
				value: defaultArgs,
				validateInput: (value) => {
					try {
						const parsed = JSON.parse(value);
						if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
							return '必须是字符串数组 JSON。';
						}
						return undefined;
					} catch {
						return '请输入合法 JSON。';
					}
				}
			});
			if (!argsInput) {
				return undefined;
			}

			const defaultCwd = typeof original.cwd === 'string' ? original.cwd : '';
			const cwd = await vscode.window.showInputBox({
				prompt: '可选：输入工作目录（留空则不设置）',
				value: defaultCwd
			});
			const args = JSON.parse(argsInput) as string[];
			nextServer = {
				...original,
				transport: 'stdio',
				command: command.trim(),
				args
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
				prompt: `输入 "${nextName}" 的 MCP URL`,
				value: defaultUrl,
				validateInput: (value) => {
					try {
						if (!value.trim()) {
							return 'URL 不能为空。';
						}
						new URL(value.trim());
						return undefined;
					} catch {
						return '请输入合法 URL。';
					}
				}
			});
			if (!url) {
				return undefined;
			}

			nextServer = {
				...original,
				transport: 'http',
				url: url.trim()
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
