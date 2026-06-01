import * as assert from 'assert';
import { createHash } from 'node:crypto';
import {
	SYSTEM_PROMPT,
	agentPrompt,
	loadPrompt,
	withWorkingDirectory
} from '../prompts/index.js';
import type { ChatFocusTarget } from '../types/chat';

function shortHash(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

suite('prompts', () => {
	test('system prompt encodes the delegation contract and mentor identity', () => {
		assert.ok(SYSTEM_PROMPT.length > 0);
		assert.strictEqual(loadPrompt('system'), SYSTEM_PROMPT);

		// Mentor identity + the agents the main agent delegates to by name.
		assert.match(SYSTEM_PROMPT, /Navi is a mentor/);
		for (const agentName of ['code_explorer', 'planning_agent', 'critic', 'code-review']) {
			assert.ok(
				SYSTEM_PROMPT.includes(agentName),
				`system prompt should name the "${agentName}" delegation target`
			);
		}

		// Navi-state tools the main agent owns for focus + wrap-up.
		for (const toolName of ['focus_user_code_region', 'clear_focus_code_region', 'manage_todos', 'update_progress']) {
			assert.ok(SYSTEM_PROMPT.includes(toolName), `system prompt should reference ${toolName}`);
		}
	});

	test('exploration prompt reads code and reports progress', () => {
		const exploration = agentPrompt('exploration');

		assert.ok(exploration.length > 0);
		assert.ok(exploration.includes('update_progress'), 'explorer should report milestone progress');
		for (const readTool of ['view', 'grep', 'glob', 'lsp']) {
			assert.ok(exploration.includes(readTool), `exploration prompt should use the ${readTool} tool`);
		}
	});

	test('planning prompt writes todos and can read code', () => {
		const planning = agentPrompt('planning');

		assert.ok(planning.length > 0);
		assert.match(planning, /planning agent/i);
		assert.ok(planning.includes('manage_todos'), 'planning prompt should write via manage_todos');
		for (const readTool of ['view', 'grep', 'glob', 'lsp']) {
			assert.ok(planning.includes(readTool), `planning prompt should use the ${readTool} tool`);
		}
		assert.ok(planning.includes('acceptance'), 'planning prompt should define acceptance criteria');
	});

	test('withWorkingDirectory injects the cwd and is a no-op without one', () => {
		const cwd = 'E:/navi';
		const withCwd = withWorkingDirectory('SYSTEM BODY', cwd);

		assert.ok(withCwd.startsWith('SYSTEM BODY'));
		assert.ok(withCwd.includes(cwd), 'should state the working directory');
		assert.match(withCwd, /Working directory/i);

		// No workspace open → prompt is returned unchanged.
		assert.strictEqual(withWorkingDirectory('SYSTEM BODY', undefined), 'SYSTEM BODY');
	});

	test('focus-action prompt is byte-identical to the established builder output', () => {
		const target: ChatFocusTarget = {
			id: 'focus-1',
			sessionId: 'thread-1',
			path: 'a.ts',
			startLine: 1,
			endLine: 2,
			title: 'T',
			instruction: 'I',
			updatedAt: 0
		};
		const { preview, prompt } = loadPrompt('focusAction', { targets: [target], action: 'review' });
		assert.strictEqual(preview, 'Please Review the 1 Focus regions I selected.');
		assert.strictEqual(prompt.length, 221);
		assert.strictEqual(shortHash(prompt), 'f19a8dfa1d3d712b');
	});
});
