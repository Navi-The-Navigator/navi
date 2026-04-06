import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createProjectStructureTool } from '../agent/tools/projectStructureTool.js';

suite('createProjectStructureTool', () => {
	test('returns project tree for workspace directory', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-structure-'));
		await fs.mkdir(path.join(workspaceRoot, 'src', 'agent'), { recursive: true });
		await fs.writeFile(path.join(workspaceRoot, 'src', 'agent', 'tool.ts'), 'export const x = 1;\n', 'utf8');
		await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# demo\n', 'utf8');

		try {
			const tool = createProjectStructureTool(() => workspaceRoot);
			const result = await tool.func('{"maxDepth":3}');
			const payload = JSON.parse(result) as {
				error?: string;
				tree: string;
				targetPath: string;
				truncated: boolean;
			};

			assert.strictEqual(payload.error, undefined);
			assert.strictEqual(payload.targetPath, '.');
			assert.strictEqual(payload.truncated, false);
			assert.match(payload.tree, /^\.\/$/m);
			assert.match(payload.tree, /- src\//);
			assert.match(payload.tree, /- README\.md/);
			assert.match(payload.tree, /- agent\//);
			assert.match(payload.tree, /- tool\.ts/);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('rejects path traversal outside workspace', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-structure-'));

		try {
			const tool = createProjectStructureTool(() => workspaceRoot);
			const result = await tool.func('{"path":"../"}');
			const payload = JSON.parse(result) as { error?: string };

			assert.strictEqual(payload.error, 'Path is outside the workspace.');
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});
