import * as vscode from 'vscode';
import type { MCPServerConfig } from '@github/copilot-sdk';

export type McpServerEntry = Record<string, unknown> & {
	enabled?: boolean;
};

export type McpServerSettings = Record<string, McpServerEntry>;

export function parseMcpServerSettings(raw: string): McpServerSettings {
	if (!raw.trim()) {
		return {};
	}

	const parsed = JSON.parse(raw);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('navi.mcpServersJson must be a JSON object.');
	}

	const result: McpServerSettings = {};
	for (const [name, value] of Object.entries(parsed)) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new Error(`The configuration for MCP server "${name}" must be an object.`);
		}
		result[name] = value as McpServerEntry;
	}

	return result;
}

export async function readMcpServerSettings(config: vscode.WorkspaceConfiguration): Promise<McpServerSettings> {
	const raw = config.get<string>('mcpServersJson', '');
	return parseMcpServerSettings(raw);
}

export async function writeMcpServerSettings(
	config: vscode.WorkspaceConfiguration,
	servers: McpServerSettings
): Promise<void> {
	const payload = Object.keys(servers).length > 0 ? JSON.stringify(servers, null, 2) : '';
	await config.update('mcpServersJson', payload, vscode.ConfigurationTarget.Global);
}

export function toEnabledMcpConnections(servers: McpServerSettings): Record<string, MCPServerConfig> {
	const result: Record<string, MCPServerConfig> = {};
	for (const [serverName, entry] of Object.entries(servers)) {
		if (entry.enabled === false) {
			continue;
		}

		const { enabled: _enabled, ...connection } = entry;
		result[serverName] = connection as unknown as MCPServerConfig;
	}

	return result;
}
