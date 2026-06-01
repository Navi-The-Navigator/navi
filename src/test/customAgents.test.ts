import * as assert from 'assert';
import {
	CODE_EXPLORER_AGENT_DISPLAY_NAME,
	CODE_EXPLORER_AGENT_NAME,
	PLANNING_AGENT_DISPLAY_NAME,
	PLANNING_AGENT_NAME,
	createMainCustomAgents
} from '../agent/agents/customAgents.js';

suite('custom agents', () => {
	test('registers the exploration and planning agents', () => {
		const agents = createMainCustomAgents();
		const names = agents.map((agent) => agent.name);

		assert.strictEqual(agents.length, 2);
		assert.ok(names.includes(CODE_EXPLORER_AGENT_NAME));
		assert.ok(names.includes(PLANNING_AGENT_NAME));
	});

	test('code explorer can read code and report progress', () => {
		const agent = createMainCustomAgents().find((item) => item.name === CODE_EXPLORER_AGENT_NAME);

		assert.ok(agent);
		assert.strictEqual(agent?.displayName, CODE_EXPLORER_AGENT_DISPLAY_NAME);
		assert.strictEqual(agent?.infer, false);
		assert.deepStrictEqual(agent?.tools, ['grep', 'glob', 'view', 'lsp', 'bash', 'update_progress']);
		// The whole point of the custom explorer: it carries update_progress, which
		// the built-in `explore` agent cannot.
		assert.ok(agent?.tools?.includes('update_progress'));
	});

	test('planning agent can read code and write todos', () => {
		const agent = createMainCustomAgents().find((item) => item.name === PLANNING_AGENT_NAME);

		assert.ok(agent);
		assert.strictEqual(agent?.displayName, PLANNING_AGENT_DISPLAY_NAME);
		assert.strictEqual(agent?.infer, false);
		assert.deepStrictEqual(agent?.tools, [
			'manage_todos',
			'update_progress',
			'view',
			'grep',
			'glob',
			'lsp'
		]);
	});
});
