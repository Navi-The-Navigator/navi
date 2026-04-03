import * as vscode from 'vscode';
import { ChatOpenAI } from '@langchain/openai';

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-reasoner';
export const DEFAULT_RECURSION_LIMIT = 150;

type ChatModelOptions = {
	temperature?: number;
};

export function createDeepSeekChatModel(
	config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('navi'),
	options: ChatModelOptions = {}
): ChatOpenAI {
	const apiKey = resolveApiKey(config);
	if (!apiKey) {
		throw new Error('缺少 API Key。请先通过 Settings 配置 navi.deepseekApiKey，或确认使用环境变量 DEEPSEEK_API_KEY。');
	}

	return new ChatOpenAI({
		apiKey,
		model: resolveModel(config),
		temperature: options.temperature ?? config.get<number>('temperature', 0.2),
		configuration: { baseURL: resolveBaseUrl(config) }
	});
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