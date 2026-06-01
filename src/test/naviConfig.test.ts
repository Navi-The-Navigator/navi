import * as assert from 'assert';
import {
	DEFAULT_API_BASE_URL,
	DEFAULT_MODEL,
	readNaviConfig,
	resolveAuthMode,
	resolveBaseUrl,
	resolveModel,
	resolveStreaming
} from '../settings/naviConfig.js';

/**
 * Guards the single-config-source refactor (Step 2): with no workspace
 * overrides, the resolvers must return the documented defaults. (API-key value
 * is environment-dependent, so it is not asserted here.)
 */
suite('naviConfig', () => {
	test('resolves documented defaults when nothing is overridden', () => {
		assert.strictEqual(resolveAuthMode(), 'copilot');
		assert.strictEqual(resolveModel(), DEFAULT_MODEL);
		assert.strictEqual(resolveModel(), 'gpt-5-mini');
		assert.strictEqual(resolveBaseUrl(), DEFAULT_API_BASE_URL);
		assert.strictEqual(resolveStreaming(), true);
	});

	test('snapshot exposes the full resolved configuration shape', () => {
		const snapshot = readNaviConfig();
		assert.strictEqual(snapshot.authMode, 'copilot');
		assert.strictEqual(snapshot.model, DEFAULT_MODEL);
		assert.strictEqual(snapshot.apiBaseUrl, DEFAULT_API_BASE_URL);
		assert.strictEqual(snapshot.streaming, true);
		assert.strictEqual(snapshot.mcpEnabled, false);
		assert.strictEqual(typeof snapshot.apiKey, 'string');
		assert.strictEqual(typeof snapshot.mcpServersJson, 'string');
	});
});
