import { HumanMessage, type MessageContent } from '@langchain/core/messages';
import { DynamicTool } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import * as vscode from 'vscode';
import { extractMessageText } from '../../utils/message';
import { createDeepSeekChatModel, resolveRecursionLimit } from '../modelFactory';
import { createProjectStructureTool } from '../tools/projectStructureTool';
import { createReadFileTool } from '../tools/readFileTool';
import { createSearchFileContentTool } from '../tools/searchFileContentTool';
import { createSearchFilesTool } from '../tools/searchFilesTool';
import { createGetWorkspaceErrorsTool } from '../tools/getWorkspaceErrorsTool';
import type { SubagentTraceCallbacks } from '../subagentTrace';
import { createUpdateProgressTool } from '../tools/updateProgressTool';
import { CODE_REVIEW_AGENT_SYSTEM_PROMPT } from './config';

type WorkspaceRootResolver = () => string | undefined;

type CodeReviewFocusRegion = {
	path?: string;
	startLine?: number;
	endLine?: number;
	title?: string;
	instruction?: string;
};

type CodeReviewToolInput = {
	request?: string;
	paths?: string[];
	focusRegions?: CodeReviewFocusRegion[];
};

type CodeReviewRunnerInput = {
	workspaceRoot: string;
	request: string;
	paths: string[];
	focusRegions: CodeReviewFocusRegion[];
	prompt: string;
	trace?: SubagentTraceCallbacks;
};

type CodeReviewRunner = (input: CodeReviewRunnerInput) => Promise<string>;

export function createCodeReviewTool(
	resolveWorkspaceRoot: WorkspaceRootResolver = getWorkspaceRoot,
	runReview: CodeReviewRunner = runCodeReview,
	trace?: SubagentTraceCallbacks
): DynamicTool {
	return new DynamicTool({
		name: 'code_review_agent',
		description:
			'Delegate a request to an independent read-only task assessment agent. Use this when the user wants to evaluate whether a coding task is actually finished, what evidence supports that, and what gaps or risks remain. Input can be plain text, or JSON like {"request":"check whether auth flow work is complete","paths":["src/auth.ts"],"focusRegions":[{"path":"src/auth.ts","startLine":10,"endLine":40,"title":"validate token"}]}. Returns JSON with a concise assessment summary for the caller; detailed assessment text is rendered in the dedicated subpanel.',
		func: async (rawInput) => {
			const workspaceRoot = resolveWorkspaceRoot();
			if (!workspaceRoot) {
				return errorResult('No workspace folder is open.');
			}

			const input = parseInput(rawInput);
			const request = (input.request ?? '').trim();
			if (!request) {
				return errorResult('Missing required field: request.');
			}

			const paths = normalizePaths(input.paths);
			const focusRegions = normalizeFocusRegions(input.focusRegions);
			const prompt = buildReviewPrompt(request, paths, focusRegions);

			const review = await runReview({
				workspaceRoot,
				request,
				paths,
				focusRegions,
				prompt,
				trace
			});

			return JSON.stringify(
				{
					request,
					paths,
					focusRegionCount: focusRegions.length,
					review: buildCallerFacingResult(review),
					detailInSubpanel: true
				},
				null,
				2
			);
		}
	});
}

function getWorkspaceRoot(): string | undefined {
	const firstFolder = vscode.workspace.workspaceFolders?.[0];
	return firstFolder?.uri.fsPath;
}

function parseInput(rawInput: string): CodeReviewToolInput {
	const text = rawInput.trim();
	if (!text) {
		return {};
	}

	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text) as CodeReviewToolInput;
			return parsed ?? {};
		} catch {
			return { request: text };
		}
	}

	return { request: text };
}

function normalizePaths(paths: string[] | undefined): string[] {
	if (!Array.isArray(paths)) {
		return [];
	}

	return paths.map((item) => item.trim()).filter(Boolean);
}

function normalizeFocusRegions(focusRegions: CodeReviewFocusRegion[] | undefined): CodeReviewFocusRegion[] {
	if (!Array.isArray(focusRegions)) {
		return [];
	}

	return focusRegions
		.map((region) => ({
			path: (region.path ?? '').trim(),
			startLine: normalizeOptionalInteger(region.startLine),
			endLine: normalizeOptionalInteger(region.endLine),
			title: (region.title ?? '').trim(),
			instruction: (region.instruction ?? '').trim()
		}))
		.filter((region) => Boolean(region.path));
}

function normalizeOptionalInteger(value: number | undefined): number | undefined {
	if (!Number.isFinite(value)) {
		return undefined;
	}
	const integer = Math.trunc(value as number);
	return integer > 0 ? integer : undefined;
}

function buildReviewPrompt(request: string, paths: string[], focusRegions: CodeReviewFocusRegion[]): string {
	const sections = [`用户希望你评估的任务：\n${request}`];

	if (paths.length > 0) {
		sections.push(`建议优先核对的路径：\n${paths.map((item) => `- ${item}`).join('\n')}`);
	}

	if (focusRegions.length > 0) {
		sections.push(
			`用户显式标记的重点区域：\n${focusRegions
				.map((region, index) => {
					const lineRange = formatLineRange(region.startLine, region.endLine);
					const title = region.title ? `\n标题: ${region.title}` : '';
					const instruction = region.instruction ? `\n说明: ${region.instruction}` : '';
					return `${index + 1}. ${region.path}${lineRange}${title}${instruction}`;
				})
				.join('\n\n')}`
		);
	}

	sections.push(
		[
			'请先确认用户要达成的结果，再沿着相关代码、配置、测试、集成点和工作区诊断收集证据。必要时使用 read_project_structure、search_files、search_file_content、read_file、get_workspace_errors。',
			'你的重点是判断：这个任务是否真的完成、完成到什么程度、还缺什么、哪里可能出问题。',
			'如果证据不足，不要硬下结论，直接给出“无法判断”并说明缺失的证据。',
			'最终输出必须严格包含这些标题：结论、概述、已完成的证据、待补充或潜在问题、验证与后续建议。'
		].join('\n')
	);

	return sections.join('\n\n');
}

function formatLineRange(startLine: number | undefined, endLine: number | undefined): string {
	if (!startLine && !endLine) {
		return '';
	}
	if (startLine && endLine) {
		return `:${startLine}-${endLine}`;
	}
	if (startLine) {
		return `:${startLine}`;
	}
	return '';
}

function buildCallerFacingResult(review: string): string {
	const verdict = extractAssessmentVerdict(review);
	if (!verdict) {
		return '任务评估已完成，详细结果见独立面板。';
	}

	if (verdict === '已完成') {
		return '任务评估已完成，当前实现基本覆盖目标；详细结果见独立面板。';
	}

	if (verdict === '部分完成') {
		return '任务评估已完成，发现仍有缺口或风险；详细结果见独立面板。';
	}

	if (verdict === '未完成') {
		return '任务评估已完成，当前任务尚未完成；详细结果见独立面板。';
	}

	return '任务评估已完成，但现有证据不足以下结论；详细结果见独立面板。';
}

function extractAssessmentVerdict(review: string): '已完成' | '部分完成' | '未完成' | '无法判断' | undefined {
	const match = review.match(/结论\s*[:：]\s*(已完成|部分完成|未完成|无法判断)/);
	return match?.[1] as '已完成' | '部分完成' | '未完成' | '无法判断' | undefined;
}

async function runCodeReview(input: CodeReviewRunnerInput): Promise<string> {
	const config = vscode.workspace.getConfiguration('navi');
	const startedAt = Date.now();
	const runId = await input.trace?.start?.({
		title: 'Task Assessment Agent',
		kind: 'code_review',
		request: input.request,
		paths: input.paths,
		metadata: {
			focusRegions: input.focusRegions
		}
	});
	const agent = createReactAgent({
		llm: createDeepSeekChatModel(config, { temperature: 0.1 }),
		tools: [
			createProjectStructureTool(() => input.workspaceRoot),
			createReadFileTool(() => input.workspaceRoot),
			createSearchFilesTool(() => input.workspaceRoot),
			createSearchFileContentTool(() => input.workspaceRoot),
			createGetWorkspaceErrorsTool(() => input.workspaceRoot),
			createUpdateProgressTool({
				onProgress: async (text) => {
					if (!runId || !input.trace?.onProgress) {
						return;
					}
					await input.trace.onProgress(runId, text);
				}
			})
		],
		prompt: CODE_REVIEW_AGENT_SYSTEM_PROMPT
	});

	try {
		let reviewText = '';
		const stream = await agent.streamEvents(
			{
				messages: [new HumanMessage(input.prompt)]
			},
			{
				version: 'v2',
				recursionLimit: resolveRecursionLimit(config),
				signal: input.trace?.getAbortSignal?.()
			}
		);

		for await (const chunk of stream) {
			if (chunk.event === 'on_tool_start') {
				if (runId && input.trace?.onToolStart) {
					await input.trace.onToolStart(runId, chunk.name ?? 'unknown_tool');
				}
				continue;
			}

			if (chunk.event === 'on_tool_end') {
				if (runId && input.trace?.onToolEnd) {
					await input.trace.onToolEnd(runId, chunk.name);
				}
				continue;
			}

			if (chunk.event !== 'on_chat_model_stream') {
				continue;
			}

			const modelChunk = chunk.data?.chunk;
			const delta = extractMessageText(modelChunk?.content as MessageContent | undefined);
			if (!delta) {
				continue;
			}

			reviewText += delta;
			if (runId && input.trace?.onAssistantDelta) {
				await input.trace.onAssistantDelta(runId, delta);
			}
		}

		const finalReview = reviewText.trim() || '结论: 无法判断\n概述: 任务评估 agent 没有生成最终文本，当前无法确认任务完成度。\n已完成的证据:\n- 未获取到可用结论。\n待补充或潜在问题:\n- 当前输出为空，无法判断实现状态。\n验证与后续建议:\n- 建议重试一次，并缩小评估范围。';
		if (runId && input.trace?.onFinish) {
			await input.trace.onFinish(runId, {
				finalText: finalReview,
				elapsedText: formatElapsedText(Date.now() - startedAt)
			});
		}
		return finalReview;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (runId && input.trace?.onError) {
			await input.trace.onError(runId, {
				message,
				elapsedText: formatElapsedText(Date.now() - startedAt)
			});
		}
		throw error;
	}
}

function formatElapsedText(elapsedMs: number): string {
	return `用时：${(elapsedMs / 1000).toFixed(2)}s`;
}

function errorResult(message: string): string {
	return JSON.stringify({ error: message }, null, 2);
}