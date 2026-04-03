import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { createGetWorkspaceErrorsTool } from '../agent/tools/getWorkspaceErrorsTool';

suite('createGetWorkspaceErrorsTool', () => {
	test('returns workspace errors and filters out warnings by default', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-errors-'));
		const filePath = path.join(workspaceRoot, 'src', 'demo.ts');
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, 'const value = 1;\n', 'utf8');

		try {
			const tool = createGetWorkspaceErrorsTool(
				() => workspaceRoot,
				() => [
					[
						vscode.Uri.file(filePath),
						[
							new vscode.Diagnostic(
								new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5)),
								'broken error',
								vscode.DiagnosticSeverity.Error
							),
							new vscode.Diagnostic(
								new vscode.Range(new vscode.Position(0, 6), new vscode.Position(0, 11)),
								'just a warning',
								vscode.DiagnosticSeverity.Warning
							)
						]
					]
				]
			);

			const result = await tool.invoke('');
			const payload = JSON.parse(result) as {
				error?: string;
				count: number;
				includeWarnings: boolean;
				truncated: boolean;
				results: Array<{
					path: string;
					severity: string;
					message: string;
					line: number;
					column: number;
					endLine: number;
					endColumn: number;
					source?: string;
					code?: string | number;
				}>;
			};

			assert.strictEqual(payload.error, undefined);
			assert.strictEqual(payload.includeWarnings, false);
			assert.strictEqual(payload.count, 1);
			assert.strictEqual(payload.truncated, false);
			assert.deepStrictEqual(payload.results, [
				{
					path: 'src/demo.ts',
					severity: 'error',
					message: 'broken error',
					line: 1,
					column: 1,
					endLine: 1,
					endColumn: 6
				}
			]);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('includes warnings and filters by requested paths', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-errors-'));
		const demoPath = path.join(workspaceRoot, 'src', 'demo.ts');
		const otherPath = path.join(workspaceRoot, 'src', 'other.ts');
		await fs.mkdir(path.dirname(demoPath), { recursive: true });
		await fs.writeFile(demoPath, 'const value = 1;\n\n', 'utf8');
		await fs.writeFile(otherPath, 'const other = 2;\n', 'utf8');

		try {
			const tool = createGetWorkspaceErrorsTool(
				() => workspaceRoot,
				() => [
					[
						vscode.Uri.file(demoPath),
						[
							new vscode.Diagnostic(
								new vscode.Range(new vscode.Position(1, 2), new vscode.Position(1, 3)),
								'warning in demo',
								vscode.DiagnosticSeverity.Warning
							)
						]
					],
					[
						vscode.Uri.file(otherPath),
						[
							new vscode.Diagnostic(
								new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
								'error in other',
								vscode.DiagnosticSeverity.Error
							)
						]
					]
				]
			);

			const result = await tool.invoke('{"paths":["src/demo.ts"],"includeWarnings":true}');
			const payload = JSON.parse(result) as {
				count: number;
				results: Array<{
					path: string;
					severity: string;
					message: string;
					line: number;
					column: number;
					endLine: number;
					endColumn: number;
					source?: string;
					code?: string | number;
				}>;
			};

			assert.strictEqual(payload.count, 1);
			assert.deepStrictEqual(payload.results, [
				{
					path: 'src/demo.ts',
					severity: 'warning',
					message: 'warning in demo',
					line: 2,
					column: 3,
					endLine: 2,
					endColumn: 4
				}
			]);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('rejects paths outside workspace', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'navi-errors-'));

		try {
			const tool = createGetWorkspaceErrorsTool(() => workspaceRoot, () => []);
			const result = await tool.invoke('{"paths":["../outside.ts"]}');
			const payload = JSON.parse(result) as { error?: string };

			assert.strictEqual(payload.error, 'Path is outside the workspace: ../outside.ts');
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('rejects when no workspace is open', async () => {
		const tool = createGetWorkspaceErrorsTool(() => undefined, () => []);
		const result = await tool.invoke('');
		const payload = JSON.parse(result) as { error?: string };

		assert.strictEqual(payload.error, 'No workspace folder is open.');
	});
});