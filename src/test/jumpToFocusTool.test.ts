import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createJumpToFocusTool } from '../agent/tools/jumpToFocusTool.js';
import type { ChatFocusTarget } from '../types/chat';

suite('createJumpToFocusTool', () => {
	test('returns error when no workspace folder is available', async () => {
		const tool = createJumpToFocusTool({
			getCurrentSessionId: () => 'session-a',
			jumpToFocus: async () => {
				throw new Error('should not be called');
			},
			resolveWorkspaceRoot: () => undefined
		});

		const result = await tool.func('{}');
		const payload = JSON.parse(result) as { ok: boolean; error?: string };
		assert.strictEqual(payload.ok, false);
		assert.strictEqual(payload.error, 'No workspace folder is open.');
	});

	test('passes empty input through to jump callback and returns active focus target', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-jump-focus-'));
		const activeFocusTarget: ChatFocusTarget = {
			id: 'focus-1',
			sessionId: 'session-b',
			path: 'src/demo.ts',
			startLine: 4,
			endLine: 8,
			title: 'Current task',
			instruction: 'Continue here',
			updatedAt: Date.now()
		};
		let capturedInput: { id?: string; index?: number } | undefined;

		const tool = createJumpToFocusTool({
			getCurrentSessionId: () => 'session-b',
			jumpToFocus: async (_sessionId, input) => {
				capturedInput = input;
				return {
					activeIndex: 0,
					activeFocusTarget,
					count: 2
				};
			},
			resolveWorkspaceRoot: () => workspaceRoot
		});

		try {
			const result = await tool.func('');
			const payload = JSON.parse(result) as {
				ok: boolean;
				sessionId: string;
				count: number;
				activeIndex: number;
				activeFocusTarget: ChatFocusTarget;
			};

			assert.strictEqual(payload.ok, true);
			assert.strictEqual(payload.sessionId, 'session-b');
			assert.strictEqual(payload.count, 2);
			assert.strictEqual(payload.activeIndex, 0);
			assert.strictEqual(payload.activeFocusTarget.id, 'focus-1');
			assert.deepStrictEqual(capturedInput, {});
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('supports jumping by id or index', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-jump-focus-'));
		const capturedInputs: Array<{ id?: string; index?: number }> = [];

		const tool = createJumpToFocusTool({
			getCurrentSessionId: () => 'session-c',
			jumpToFocus: async (_sessionId, input) => {
				capturedInputs.push(input);
				return {
					activeIndex: Number.isFinite(input.index) ? (input.index as number) : 1,
					activeFocusTarget: null,
					count: 3
				};
			},
			resolveWorkspaceRoot: () => workspaceRoot
		});

		try {
			const idResult = JSON.parse(await tool.func('{"id":"focus-2"}')) as {
				ok: boolean;
				activeIndex: number;
			};
			const indexResult = JSON.parse(await tool.func('{"index":2}')) as {
				ok: boolean;
				activeIndex: number;
			};

			assert.strictEqual(idResult.ok, true);
			assert.strictEqual(idResult.activeIndex, 1);
			assert.strictEqual(indexResult.ok, true);
			assert.strictEqual(indexResult.activeIndex, 2);
			assert.deepStrictEqual(capturedInputs, [{ id: 'focus-2' }, { index: 2 }]);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});