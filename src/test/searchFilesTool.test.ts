import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createSearchFilesTool } from '../agent/tools/searchFilesTool';

suite('createSearchFilesTool', () => {
	test('finds files and directories by query', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-search-files-'));
		await fs.mkdir(path.join(workspaceRoot, 'src', 'ws'), { recursive: true });
		await fs.writeFile(path.join(workspaceRoot, 'src', 'ws', 'socketPing.ts'), 'export const ok = true;\n', 'utf8');

		try {
			const tool = createSearchFilesTool(() => workspaceRoot);
			const result = await tool.invoke('socket');
			const payload = JSON.parse(result) as {
				error?: string;
				count: number;
				results: Array<{ path: string; type: 'file' | 'directory' }>;
			};

			assert.strictEqual(payload.error, undefined);
			assert.ok(payload.count >= 1);
			assert.ok(payload.results.some((item) => item.path.endsWith('socketPing.ts') && item.type === 'file'));
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});
