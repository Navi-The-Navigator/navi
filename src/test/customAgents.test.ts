import * as assert from 'assert';
import {
	CODE_EXPLORATION_AGENT_DISPLAY_NAME,
	CODE_EXPLORATION_AGENT_NAME,
	createMainCustomAgents
} from '../agent/agents/customAgents.js';

suite('custom agents', () => {
	test('registers code exploration agent with read-only exploration tools', () => {
		const agent = createMainCustomAgents().find((item) => item.name === CODE_EXPLORATION_AGENT_NAME);

		assert.ok(agent);
		assert.strictEqual(agent?.displayName, CODE_EXPLORATION_AGENT_DISPLAY_NAME);
		assert.strictEqual(agent?.infer, false);
		assert.deepStrictEqual(agent?.tools, ['get_errors', 'update_progress']);
		assert.ok(!agent?.tools.includes('manage_todos'));
		assert.ok(!agent?.tools.includes('clear_focus_code_region'));
	});
});