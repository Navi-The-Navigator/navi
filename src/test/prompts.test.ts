import * as assert from 'assert';
import { createHash } from 'node:crypto';
import {
	SYSTEM_PROMPT,
	agentPrompt,
	loadPrompt
} from '../prompts/index.js';
import type { ChatFocusTarget } from '../types/chat';

/**
 * Byte-identity guard for the prompt-extraction refactor (Step 1).
 * The hashes/lengths below were captured from the pre-refactor inline prompts.
 * If a prompt's content legitimately changes, update the expected values in the
 * same commit so the change is explicit and reviewable.
 */
function shortHash(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

suite('prompts', () => {
	test('system prompt is byte-identical to the pre-refactor inline prompt', () => {
		assert.strictEqual(SYSTEM_PROMPT.length, 4067);
		assert.strictEqual(shortHash(SYSTEM_PROMPT), '3ec5d11201075798');
		assert.strictEqual(loadPrompt('system'), SYSTEM_PROMPT);
	});

	test('sub-agent prompts are byte-identical to the pre-refactor inline prompts', () => {
		assert.strictEqual(agentPrompt('codeReview').length, 3205);
		assert.strictEqual(shortHash(agentPrompt('codeReview')), '55774f156980a00e');

		assert.strictEqual(agentPrompt('codeExploration').length, 1758);
		assert.strictEqual(shortHash(agentPrompt('codeExploration')), '1347b6f17f20c2a0');

		assert.strictEqual(agentPrompt('planning').length, 2545);
		assert.strictEqual(shortHash(agentPrompt('planning')), '4fa1eba0d5a2bd7e');
	});

	test('focus-action prompt is byte-identical to the pre-refactor builder output', () => {
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
