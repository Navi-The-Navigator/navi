import * as assert from 'assert';
import { createThreadId, getNonce } from '../utils/id';

suite('id utilities', () => {
	test('creates thread ids with the expected prefix', () => {
		const id = createThreadId();

		assert.match(id, /^thread-\d+-[a-z0-9]{8}$/);
	});

	test('creates 32-character alphanumeric nonces', () => {
		const nonce = getNonce();

		assert.strictEqual(nonce.length, 32);
		assert.match(nonce, /^[A-Za-z0-9]{32}$/);
	});
});