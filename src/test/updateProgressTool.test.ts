import * as assert from 'assert';
import { createUpdateProgressTool } from '../agent/tools/updateProgressTool.js';

suite('createUpdateProgressTool', () => {
	test('posts plain text progress update', async () => {
		const progressUpdates: string[] = [];
		const tool = createUpdateProgressTool({
			onProgress: (text) => {
				progressUpdates.push(text);
			}
		});

		const result = JSON.parse(await tool.func('正在扫描项目结构')) as {
			ok: boolean;
			text: string;
		};

		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.text, '正在扫描项目结构');
		assert.deepStrictEqual(progressUpdates, ['正在扫描项目结构']);
	});

	test('supports structured progress payload', async () => {
		const progressUpdates: string[] = [];
		const tool = createUpdateProgressTool({
			onProgress: (text) => {
				progressUpdates.push(text);
			}
		});

		const result = JSON.parse(
			await tool.func('{"text":"已定位核心模块","stage":"analysis","status":"in_progress"}')
		) as {
			ok: boolean;
			text: string;
		};

		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.text, '[analysis | in_progress] 已定位核心模块');
		assert.deepStrictEqual(progressUpdates, ['[analysis | in_progress] 已定位核心模块']);
	});

	test('returns error when progress text is missing', async () => {
		let called = false;
		const tool = createUpdateProgressTool({
			onProgress: () => {
				called = true;
			}
		});

		const result = JSON.parse(await tool.func('{"stage":"analysis"}')) as {
			ok: boolean;
			error: string;
		};

		assert.strictEqual(result.ok, false);
		assert.match(result.error, /Progress text is required/);
		assert.strictEqual(called, false);
	});
});
