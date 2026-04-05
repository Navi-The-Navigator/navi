import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createClearFocusCodeRegionTool } from '../agent/tools/clearFocusCodeRegionTool';
import type { ChatFocusTarget } from '../types/chat';

suite('createClearFocusCodeRegionTool', () => {
	test('validates required selector when clearAll is false', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-clear-focus-'));
		const tool = createClearFocusCodeRegionTool({
			getCurrentSessionId: () => 'session-a',
			clearFocusRegions: async () => {
				throw new Error('should not be called');
			},
			resolveWorkspaceRoot: () => workspaceRoot
		});

		try {
			const result = await tool.func('{}');
			const payload = JSON.parse(result) as { ok: boolean; error?: string };
			assert.strictEqual(payload.ok, false);
			assert.strictEqual(payload.error, 'Provide id or path, or set clearAll=true.');
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('passes normalized path to callback and returns clear summary', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-clear-focus-'));
		let capturedPath = '';
		const activeFocusTarget: ChatFocusTarget = {
			id: 'focus-1',
			sessionId: 'session-b',
			path: 'src/demo.ts',
			startLine: 3,
			endLine: 6,
			title: 'Current task',
			instruction: 'Edit block',
			updatedAt: Date.now()
		};

		const tool = createClearFocusCodeRegionTool({
			getCurrentSessionId: () => 'session-b',
			clearFocusRegions: async (_sessionId, input) => {
				capturedPath = input.path ?? '';
				return {
					removedCount: 1,
					remainingCount: 2,
					activeFocusTarget
				};
			},
			resolveWorkspaceRoot: () => workspaceRoot
		});

		try {
			const result = await tool.func('{"path":"src\\\\demo.ts","startLine":1,"endLine":10}');
			const payload = JSON.parse(result) as {
				ok: boolean;
				sessionId: string;
				removedCount: number;
				remainingCount: number;
				activeFocusTarget: ChatFocusTarget;
			};
			assert.strictEqual(payload.ok, true);
			assert.strictEqual(payload.sessionId, 'session-b');
			assert.strictEqual(capturedPath, 'src/demo.ts');
			assert.strictEqual(payload.removedCount, 1);
			assert.strictEqual(payload.remainingCount, 2);
			assert.strictEqual(payload.activeFocusTarget.id, 'focus-1');
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});
