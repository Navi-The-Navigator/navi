import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createFocusCodeRegionTool } from '../agent/tools/focusCodeRegionTool';
import type { ChatFocusTarget } from '../types/chat';

suite('createFocusCodeRegionTool', () => {
	test('validates path boundary before requesting focus', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-focus-'));
		let called = false;
		const tool = createFocusCodeRegionTool({
			getCurrentSessionId: () => 'session-a',
			focusRegion: async () => {
				called = true;
				throw new Error('should not be called');
			},
			resolveWorkspaceRoot: () => workspaceRoot
		});

		try {
			const result = await tool.func('{"path":"../outside.ts"}');
			const payload = JSON.parse(result) as { ok: boolean; error?: string };
			assert.strictEqual(payload.ok, false);
			assert.strictEqual(payload.error, 'Path is outside the workspace.');
			assert.strictEqual(called, false);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('passes normalized input to focus callback and returns focus target', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-focus-'));
		const filePath = path.join(workspaceRoot, 'src', 'demo.ts');
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, 'export const demo = 1;\n', 'utf8');

		let capturedPath = '';
		const focusTarget: ChatFocusTarget = {
			id: 'focus-1',
			sessionId: 'session-b',
			path: 'src/demo.ts',
			startLine: 1,
			endLine: 1,
			title: 'Next coding task',
			instruction: 'Implement logic here',
			updatedAt: Date.now()
		};

		const tool = createFocusCodeRegionTool({
			getCurrentSessionId: () => 'session-b',
			focusRegion: async (_sessionId, input) => {
				capturedPath = input.path ?? '';
				return focusTarget;
			},
			resolveWorkspaceRoot: () => workspaceRoot
		});

		try {
			const result = await tool.func('{"path":"src\\\\demo.ts","startLine":1,"endLine":1}');
			const payload = JSON.parse(result) as {
				ok: boolean;
				sessionId: string;
				focusTarget: ChatFocusTarget;
			};

			assert.strictEqual(payload.ok, true);
			assert.strictEqual(payload.sessionId, 'session-b');
			assert.strictEqual(capturedPath, 'src/demo.ts');
			assert.strictEqual(payload.focusTarget.path, 'src/demo.ts');
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});
