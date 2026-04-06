import * as vscode from 'vscode';

const agentFlowOutput = vscode.window.createOutputChannel('Navi Agent Flow');
const DEFAULT_PREVIEW_LIMIT = 160;

export function logAgentFlow(scope: string, message: string, details?: Record<string, unknown>): void {
	const config = vscode.workspace.getConfiguration('navi');
	if (!config.get<boolean>('debugAgentReplyFlow', false)) {
		return;
	}

	const timestamp = new Date().toISOString();
	const detailText = formatDetails(details);
	agentFlowOutput.appendLine(`[${timestamp}] [${scope}] ${message}${detailText ? ` ${detailText}` : ''}`);
	if (config.get<boolean>('debugAgentReplyFlowReveal', false)) {
		agentFlowOutput.show(true);
	}
}

export function summarizeText(text: string | undefined, limit = DEFAULT_PREVIEW_LIMIT): string {
	const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
	if (!normalized) {
		return '';
	}
	if (normalized.length <= limit) {
		return normalized;
	}
	return `${normalized.slice(0, limit)}...`;
}

function formatDetails(details: Record<string, unknown> | undefined): string {
	if (!details || Object.keys(details).length === 0) {
		return '';
	}

	try {
		return JSON.stringify(details, (_key, value) => normalizeValue(value));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return JSON.stringify({ serializationError: message });
	}
}

function normalizeValue(value: unknown): unknown {
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack
		};
	}

	if (typeof value === 'string') {
		return summarizeText(value, 400);
	}

	if (typeof value === 'bigint') {
		return value.toString();
	}

	if (Array.isArray(value)) {
		return value.map((item) => normalizeValue(item));
	}

	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, normalizeValue(nestedValue)])
		);
	}

	return value;
}