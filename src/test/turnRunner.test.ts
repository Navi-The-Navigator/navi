import * as assert from 'assert';
import type { CopilotSession, SessionEvent } from '@github/copilot-sdk';
import { runTurn } from '../agent/turnRunner.js';
import type { AgentEvent } from '../agent/sdkEventMapper.js';

/**
 * Characterization tests for the extracted turn-runner / SDK-event mapper.
 * These pin the load-bearing behaviors the refactor must preserve:
 * the parentToolCallId accumulator guard, the assistant-message fallback
 * dedupe, the sub-agent idle-reset, and cancellation.
 */

function makeFakeSession(): { session: CopilotSession; emit: (event: unknown) => void } {
	let handler: ((event: SessionEvent) => void) | undefined;
	const session = {
		sessionId: 'thread-1',
		on: (h: (event: SessionEvent) => void) => {
			handler = h;
			return () => {
				handler = undefined;
			};
		}
	} as unknown as CopilotSession;
	return { session, emit: (event: unknown) => handler?.(event as SessionEvent) };
}

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));
const noopDeps = (onMainText: (delta: string) => void = () => {}) => ({
	beginCancellation: async () => {},
	onMainText
});

suite('turnRunner', () => {
	test('accumulates only top-level deltas and resolves on idle', async () => {
		const { session, emit } = makeFakeSession();
		let main = '';
		const deltas: Array<[string, string | undefined]> = [];
		const promise = runTurn(session, noopDeps((d) => (main += d)), {
			onAssistantDelta: (text, parent) => {
				deltas.push([text, parent]);
			}
		});
		emit({ type: 'assistant.message_delta', data: { messageId: 'm1', deltaContent: 'Hello ' } });
		emit({ type: 'assistant.message_delta', data: { messageId: 's1', deltaContent: 'sub', parentToolCallId: 'tc1' } });
		emit({ type: 'session.idle', data: {} });
		await promise;

		assert.strictEqual(main, 'Hello ', 'sub-agent delta (with parentToolCallId) must not enter main reply');
		assert.deepStrictEqual(deltas, [
			['Hello ', undefined],
			['sub', 'tc1']
		]);
	});

	test('does not settle on a pre-subagent idle and resets on subagent completion', async () => {
		const { session, emit } = makeFakeSession();
		let resolved = false;
		const promise = runTurn(session, noopDeps(), {});
		void promise.then(() => {
			resolved = true;
		});

		emit({ type: 'subagent.started', data: { toolCallId: 'tc1', agentName: 'planning_agent' } });
		emit({ type: 'session.idle', data: {} });
		await macrotask();
		assert.strictEqual(resolved, false, 'must keep waiting while a sub-agent is active');

		emit({ type: 'subagent.completed', data: { toolCallId: 'tc1', durationMs: 5 } });
		await macrotask();
		assert.strictEqual(resolved, false, 'completion resets idle; must await a fresh session.idle');

		emit({ type: 'session.idle', data: {} });
		await promise;
		assert.strictEqual(resolved, true);
	});

	test('applies assistant.message fallback only when no delta arrived for that message', async () => {
		const { session, emit } = makeFakeSession();
		let main = '';
		const promise = runTurn(session, noopDeps((d) => (main += d)), {});
		emit({ type: 'assistant.message_delta', data: { messageId: 'm1', deltaContent: 'Hi' } });
		emit({ type: 'assistant.message', data: { messageId: 'm1', content: 'Hi' } }); // dedup: ignored
		emit({ type: 'assistant.message', data: { messageId: 'm2', content: 'Full' } }); // fallback applied
		emit({ type: 'session.idle', data: {} });
		await promise;

		assert.strictEqual(main, 'HiFull');
	});

	test('mirrors normalized events to onAgentEvent', async () => {
		const { session, emit } = makeFakeSession();
		const events: AgentEvent[] = [];
		const promise = runTurn(session, noopDeps(), {
			onAgentEvent: (e) => {
				events.push(e);
			}
		});
		emit({ type: 'tool.execution_start', data: { toolCallId: 'tc1', toolName: 'get_errors' } });
		emit({ type: 'session.idle', data: {} });
		await promise;

		assert.ok(events.some((e) => e.type === 'tool.start' && e.toolName === 'get_errors'));
		assert.ok(events.some((e) => e.type === 'session.idle'));
	});

	test('rejects with the cancellation sentinel when shouldCancel flips', async () => {
		const { session, emit } = makeFakeSession();
		let cancel = false;
		const promise = runTurn(session, noopDeps(), { shouldCancel: () => cancel });
		cancel = true;
		emit({ type: 'session.idle', data: {} });
		await assert.rejects(promise, (error: Error) => error.message.includes('__NAVI_CANCELLED__'));
	});
});
