import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createSearchFileContentTool } from '../agent/tools/searchFileContentTool';

suite('createSearchFileContentTool', () => {
	test('finds matching text in files with line numbers', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-search-content-'));
		const filePath = path.join(workspaceRoot, 'src', 'ws.ts');
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, ['const ping = true;', 'const pong = ping;'].join('\n'), 'utf8');

		try {
			const tool = createSearchFileContentTool(() => workspaceRoot);
			const result = await tool.func('{"query":"ping","path":"src"}');
			const payload = JSON.parse(result) as {
				error?: string;
				count: number;
				results: Array<{ path: string; line: number; snippet: string }>;
			};

			assert.strictEqual(payload.error, undefined);
			assert.strictEqual(payload.count, 2);
			assert.ok(payload.results.some((item) => item.path === 'src/ws.ts' && item.line === 1));
			assert.ok(payload.results.some((item) => item.path === 'src/ws.ts' && item.line === 2));
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});
