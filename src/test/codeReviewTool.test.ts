import * as assert from 'assert';
import { createCodeReviewTool } from '../agent/agents/codeReviewAgentTool';

suite('createCodeReviewTool', () => {
	test('delegates review request with normalized context', async () => {
		let captured:
			| {
				workspaceRoot: string;
				request: string;
				paths: string[];
				focusRegions: Array<{ path?: string; startLine?: number; endLine?: number; title?: string; instruction?: string }>;
				prompt: string;
			}
			| undefined;

		const tool = createCodeReviewTool(
			() => 'E:/workspace',
			async (input) => {
				captured = input;
				return '结论: 部分完成\n概述: 已覆盖主流程，但仍有遗漏。';
			}
		);

		const result = await tool.invoke(
			JSON.stringify({
				request: 'review auth flow',
				paths: ['src/auth.ts', '  src/token.ts  '],
				focusRegions: [
					{
						path: 'src/auth.ts',
						startLine: 10.8,
						endLine: 42.2,
						title: 'validate token',
						instruction: 'check missing guard'
					},
					{
						path: '   '
					}
				]
			})
		);

		const payload = JSON.parse(result) as {
			error?: string;
			request: string;
			paths: string[];
			focusRegionCount: number;
			review: string;
			detailInSubpanel?: boolean;
		};

		assert.strictEqual(payload.error, undefined);
		assert.strictEqual(payload.request, 'review auth flow');
		assert.deepStrictEqual(payload.paths, ['src/auth.ts', 'src/token.ts']);
		assert.strictEqual(payload.focusRegionCount, 1);
		assert.strictEqual(payload.review, '任务评估已完成，发现仍有缺口或风险；详细结果见独立面板。');
		assert.strictEqual(payload.detailInSubpanel, true);
		assert.ok(captured);
		assert.strictEqual(captured?.workspaceRoot, 'E:/workspace');
		assert.match(captured?.prompt ?? '', /用户希望你评估的任务/);
		assert.match(captured?.prompt ?? '', /src\/auth.ts:10-42/);
		assert.match(captured?.prompt ?? '', /建议优先核对的路径/);
		assert.match(captured?.prompt ?? '', /结论、概述、已完成的证据、待补充或潜在问题、验证与后续建议/);
	});

	test('returns a concise caller-facing summary for partially completed work', async () => {
		const tool = createCodeReviewTool(
			() => 'E:/workspace',
			async () => '结论: 部分完成\n概述: 主流程已接上，但测试和边界条件还缺失。'
		);

		const result = await tool.invoke('review current diff');
		const payload = JSON.parse(result) as { review: string; detailInSubpanel?: boolean };

		assert.strictEqual(payload.detailInSubpanel, true);
		assert.strictEqual(payload.review, '任务评估已完成，发现仍有缺口或风险；详细结果见独立面板。');
	});

	test('returns a completed caller-facing result when the task is finished', async () => {
		const tool = createCodeReviewTool(
			() => 'E:/workspace',
			async () => '结论: 已完成\n概述: 目标功能和相关测试都已经补齐。'
		);

		const result = await tool.invoke('review current diff');
		const payload = JSON.parse(result) as { review: string };

		assert.strictEqual(payload.review, '任务评估已完成，当前实现基本覆盖目标；详细结果见独立面板。');
	});

	test('returns an incomplete caller-facing result when the task is not done', async () => {
		const tool = createCodeReviewTool(
			() => 'E:/workspace',
			async () => '结论: 未完成\n概述: 目前只完成了数据层，UI 和命令接线还没做。'
		);

		const result = await tool.invoke('review current diff');
		const payload = JSON.parse(result) as { review: string };

		assert.strictEqual(payload.review, '任务评估已完成，当前任务尚未完成；详细结果见独立面板。');
	});

	test('returns an uncertain caller-facing result when evidence is insufficient', async () => {
		const tool = createCodeReviewTool(
			() => 'E:/workspace',
			async () => '结论: 无法判断\n概述: 缺少关键调用链证据，当前无法确认是否真正生效。'
		);

		const result = await tool.invoke('review current diff');
		const payload = JSON.parse(result) as { review: string };

		assert.strictEqual(payload.review, '任务评估已完成，但现有证据不足以下结论；详细结果见独立面板。');
	});

	test('rejects missing request', async () => {
		const tool = createCodeReviewTool(() => 'E:/workspace', async () => 'unused');
		const result = await tool.invoke('{"paths":["src/app.ts"]}');
		const payload = JSON.parse(result) as { error?: string };

		assert.strictEqual(payload.error, 'Missing required field: request.');
	});

	test('passes trace callbacks through to runner', async () => {
		const trace = {
			start: async () => 'run-1'
		};
		let capturedTrace: unknown;
		let capturedStartPayload: unknown;
		const tool = createCodeReviewTool(
			() => 'E:/workspace',
			async (input) => {
				capturedTrace = input.trace;
				capturedStartPayload = await input.trace?.start?.({
					title: 'Task Assessment Agent',
					kind: 'code_review'
				});
				return '结论: 已完成\n概述: 已完成。';
			},
			trace
		);

		await tool.invoke('review current diff');

		assert.strictEqual(capturedTrace, trace);
		assert.strictEqual(capturedStartPayload, 'run-1');
	});

	test('rejects when no workspace is open', async () => {
		const tool = createCodeReviewTool(() => undefined, async () => 'unused');
		const result = await tool.invoke('review current diff');
		const payload = JSON.parse(result) as { error?: string };

		assert.strictEqual(payload.error, 'No workspace folder is open.');
	});
});