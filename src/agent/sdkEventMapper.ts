import type { SessionEvent } from '@github/copilot-sdk';
import { logAgentFlow, summarizeText } from './debugLogger.js';
import { extractAssistantMessageText } from './sdkPayload.js';

/**
 * Navi's own normalized event type. The SDK's `SessionEvent` shapes are read in
 * exactly one place — {@link toAgentEvent} — so the rest of the app (turn
 * runner, generation controller, sub-agent tracker) depends only on this stable
 * union, not on the SDK's event surface.
 */
export type AgentEvent =
	| { type: 'assistant.delta'; messageId: string; text: string; parentToolCallId?: string }
	| { type: 'assistant.message'; messageId: string; text: string; parentToolCallId?: string }
	| { type: 'tool.start'; toolCallId: string; toolName: string; parentToolCallId?: string }
	| { type: 'tool.progress'; toolCallId: string; progressMessage: string }
	| { type: 'tool.complete'; toolCallId: string; success: boolean; resultContent?: string }
	| { type: 'subagent.started'; toolCallId: string; agentName?: string; agentDisplayName?: string }
	| { type: 'subagent.completed'; toolCallId: string; agentName?: string; agentDisplayName?: string; durationMs?: number }
	| { type: 'subagent.failed'; toolCallId: string; agentName?: string; durationMs?: number; error: string }
	| { type: 'session.idle' }
	| { type: 'session.error'; message: string };

/** Map a raw SDK session event to a normalized {@link AgentEvent}, or null when not relevant. */
export function toAgentEvent(event: SessionEvent): AgentEvent | null {
	switch (event.type) {
		case 'assistant.message_delta':
			return {
				type: 'assistant.delta',
				messageId: event.data.messageId,
				text: event.data.deltaContent ?? '',
				parentToolCallId: event.data.parentToolCallId
			};
		case 'assistant.message':
			return {
				type: 'assistant.message',
				messageId: event.data.messageId,
				text: extractAssistantMessageText(event.data),
				parentToolCallId: event.data.parentToolCallId
			};
		case 'tool.execution_start':
			return {
				type: 'tool.start',
				toolCallId: event.data.toolCallId,
				toolName: event.data.toolName ?? 'unknown_tool',
				parentToolCallId: event.data.parentToolCallId
			};
		case 'tool.execution_progress':
			return {
				type: 'tool.progress',
				toolCallId: event.data.toolCallId,
				progressMessage: event.data.progressMessage
			};
		case 'tool.execution_complete':
			return {
				type: 'tool.complete',
				toolCallId: event.data.toolCallId,
				success: event.data.success,
				resultContent: extractToolResultContent(event.data)
			};
		case 'subagent.started':
			return {
				type: 'subagent.started',
				toolCallId: event.data.toolCallId,
				agentName: event.data.agentName,
				agentDisplayName: event.data.agentDisplayName
			};
		case 'subagent.completed':
			return {
				type: 'subagent.completed',
				toolCallId: event.data.toolCallId,
				agentName: event.data.agentName,
				agentDisplayName: event.data.agentDisplayName,
				durationMs: event.data.durationMs
			};
		case 'subagent.failed':
			return {
				type: 'subagent.failed',
				toolCallId: event.data.toolCallId,
				agentName: event.data.agentName,
				durationMs: event.data.durationMs,
				error: event.data.error
			};
		case 'session.idle':
			return { type: 'session.idle' };
		case 'session.error':
			return { type: 'session.error', message: (event.data as { message?: string }).message ?? 'Session error' };
		default:
			return null;
	}
}

function extractToolResultContent(data: unknown): string | undefined {
	const rawResult = (data as { result?: { content?: string; detailedContent?: string } }).result;
	const content = (rawResult?.detailedContent ?? rawResult?.content ?? '').trim();
	return content || undefined;
}

/** Emit the existing per-event debug log lines for the raw SDK event stream. */
export function logSessionEvent(event: SessionEvent): void {
	switch (event.type) {
		case 'assistant.message_delta': {
			const delta = event.data.deltaContent ?? '';
			logAgentFlow('main.gateway.event', 'assistant.message_delta', {
				deltaLength: delta.length,
				deltaPreview: summarizeText(delta)
			});
			break;
		}
		case 'assistant.message': {
			const text = extractAssistantMessageText(event.data);
			logAgentFlow('main.gateway.event', 'assistant.message', {
				extractedLength: text.length,
				extractedPreview: summarizeText(text)
			});
			break;
		}
		case 'tool.execution_start':
			logAgentFlow('main.gateway.event', 'tool.execution_start', {
				toolName: event.data.toolName ?? 'unknown_tool'
			});
			break;
		case 'tool.execution_complete':
			logAgentFlow('main.gateway.event', 'tool.execution_complete', {
				toolCallId: event.data.toolCallId,
				success: event.data.success
			});
			break;
		case 'session.error':
			logAgentFlow('main.gateway.event', 'session.error', {
				message: (event.data as { message?: string }).message ?? 'Session error'
			});
			break;
		case 'session.idle':
			logAgentFlow('main.gateway.event', 'session.idle', {
				aborted: !!event.data.aborted,
				backgroundAgents: event.data.backgroundTasks?.agents?.length ?? 0,
				backgroundShells: event.data.backgroundTasks?.shells?.length ?? 0
			});
			break;
		default:
			logAgentFlow('main.gateway.event', event.type);
			break;
	}
}
