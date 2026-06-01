import * as assert from 'assert';
import { NaviChatGateway } from '../agent/gateway.js';
import type { LLMProvider } from '../agent/provider/LLMProvider.js';
import type { TurnCallbacks } from '../agent/turnRunner.js';

/**
 * Exercises the gateway's retry policy over the LLMProvider port using a fake
 * provider — no Copilot CLI required. This is the testability payoff of Step 5.
 */
class FakeProvider implements LLMProvider {
	public runCount = 0;
	public resetCount = 0;

	constructor(private readonly behavior: (attempt: number, onMainText: (delta: string) => void) => Promise<void>) {}

	async runTurn(
		_threadId: string,
		_prompt: string,
		_callbacks: TurnCallbacks,
		onMainText: (delta: string) => void
	): Promise<void> {
		this.runCount += 1;
		await this.behavior(this.runCount, onMainText);
	}

	async resetForRetry(): Promise<void> {
		this.resetCount += 1;
	}

	async dispose(): Promise<void> {}
	async invalidate(): Promise<void> {}
}

suite('NaviChatGateway', () => {
	test('returns the accumulated assistant text on success', async () => {
		const provider = new FakeProvider(async (_attempt, onMainText) => {
			onMainText('Hello');
		});
		const text = await new NaviChatGateway(provider).streamAssistantReply('t1', 'hi');
		assert.strictEqual(text, 'Hello');
		assert.strictEqual(provider.runCount, 1);
	});

	test('retries once on a transient error when nothing was emitted yet', async () => {
		const provider = new FakeProvider(async (attempt, onMainText) => {
			if (attempt === 1) {
				throw new Error('socket hang up');
			}
			onMainText('recovered');
		});
		const text = await new NaviChatGateway(provider).streamAssistantReply('t1', 'hi');
		assert.strictEqual(text, 'recovered');
		assert.strictEqual(provider.runCount, 2);
		assert.strictEqual(provider.resetCount, 1);
	});

	test('does not retry once partial text has been emitted', async () => {
		const provider = new FakeProvider(async (_attempt, onMainText) => {
			onMainText('partial');
			throw new Error('terminated');
		});
		await assert.rejects(new NaviChatGateway(provider).streamAssistantReply('t1', 'hi'));
		assert.strictEqual(provider.runCount, 1);
		assert.strictEqual(provider.resetCount, 0);
	});
});
