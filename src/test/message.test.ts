import * as assert from 'assert';
import { extractMessageText, getMessageType } from '../utils/message.js';

suite('message utilities', () => {
	test('extracts text from plain string content', () => {
		assert.strictEqual(extractMessageText('plain text'), 'plain text');
	});

	test('extracts only text segments from structured content arrays', () => {
		const content = [
			'prefix ',
			{ type: 'text', text: 'body' },
			{ type: 'image_url', image_url: { url: 'https://example.com/test.png' } }
		] as unknown as Parameters<typeof extractMessageText>[0];

		assert.strictEqual(extractMessageText(content), 'prefix body');
	});

	test('returns an empty string when content is absent or unsupported', () => {
		assert.strictEqual(extractMessageText(undefined), '');
		assert.strictEqual(extractMessageText([{ type: 'image_url' }] as never), '');
	});

	test('prefers _getType when resolving message types', () => {
		assert.strictEqual(
			getMessageType({
				_getType: () => 'ai',
				type: 'human'
			}),
			'ai'
		);
	});

	test('falls back to the type property when needed', () => {
		assert.strictEqual(getMessageType({ type: 'human' }), 'human');
		assert.strictEqual(getMessageType({}), undefined);
		assert.strictEqual(getMessageType(null), undefined);
	});
});