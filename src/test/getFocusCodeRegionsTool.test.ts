import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createGetFocusCodeRegionsTool } from '../agent/tools/getFocusCodeRegionsTool';
import type { ChatFocusTarget } from '../types/chat';

suite('createGetFocusCodeRegionsTool', () => {
	test('rejects path outside workspace', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-get-focus-'));
		const tool = createGetFocusCodeRegionsTool({
			getCurrentSessionId: () => 'session-a',
			getFocusRegions: async () => {
				throw new Error('should not be called');
			},
			resolveWorkspaceRoot: () => workspaceRoot
		});

		try {
			const result = await tool.invoke('{"path":"../outside.ts"}');
			const payload = JSON.parse(result) as { ok: boolean; error?: string };
			assert.strictEqual(payload.ok, false);
			assert.strictEqual(payload.error, 'Path is outside the workspace.');
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('returns normalized filtered focus targets', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-get-focus-'));
		let capturedPath = '';
		const focusTargets: ChatFocusTarget[] = [
			{
				id: 'focus-1',
				sessionId: 'session-b',
				path: 'src/demo.ts',
				startLine: 10,
				endLine: 14,
				title: 'Block A',
				instruction: 'Edit A',
				updatedAt: Date.now()
			}
		];

		const tool = createGetFocusCodeRegionsTool({
			getCurrentSessionId: () => 'session-b',
			getFocusRegions: async (_sessionId, input) => {
				capturedPath = input.path ?? '';
				return {
					activeIndex: 0,
					targets: focusTargets
				};
			},
			resolveWorkspaceRoot: () => workspaceRoot
		});

		try {
			const result = await tool.invoke('{"path":"src\\\\demo.ts"}');
			const payload = JSON.parse(result) as {
				ok: boolean;
				sessionId: string;
				count: number;
				activeIndex: number;
				activeFocusTarget: ChatFocusTarget;
				focusTargets: ChatFocusTarget[];
			};
			assert.strictEqual(payload.ok, true);
			assert.strictEqual(payload.sessionId, 'session-b');
			assert.strictEqual(capturedPath, 'src/demo.ts');
			assert.strictEqual(payload.count, 1);
			assert.strictEqual(payload.activeIndex, 0);
			assert.strictEqual(payload.activeFocusTarget.id, 'focus-1');
			assert.strictEqual(payload.focusTargets[0].path, 'src/demo.ts');
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});
