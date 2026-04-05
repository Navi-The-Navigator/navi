import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createReadFileTool } from '../agent/tools/readFileTool';

suite('createReadFileTool', () => {
	test('reads selected line window with line numbers', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-readfile-'));
		const filePath = path.join(workspaceRoot, 'src', 'demo.ts');
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, ['line1', 'line2', 'line3', 'line4'].join('\n'), 'utf8');

		try {
			const tool = createReadFileTool(() => workspaceRoot);
			const result = await tool.func('{"path":"src/demo.ts","startLine":2,"endLine":3}');
			const payload = JSON.parse(result) as {
				error?: string;
				path: string;
				totalLines: number;
				startLine: number;
				endLine: number;
				truncated: boolean;
				content: string;
			};

			assert.strictEqual(payload.error, undefined);
			assert.strictEqual(payload.path, 'src/demo.ts');
			assert.strictEqual(payload.totalLines, 4);
			assert.strictEqual(payload.startLine, 2);
			assert.strictEqual(payload.endLine, 3);
			assert.strictEqual(payload.truncated, false);
			assert.match(payload.content, /^2\| line2$/m);
			assert.match(payload.content, /^3\| line3$/m);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('rejects file path outside workspace', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-readfile-'));

		try {
			const tool = createReadFileTool(() => workspaceRoot);
			const result = await tool.func('../outside.txt');
			const payload = JSON.parse(result) as { error?: string };

			assert.strictEqual(payload.error, 'Path is outside the workspace.');
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});
