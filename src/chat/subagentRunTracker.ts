import type { SessionEvent } from '@github/copilot-sdk';
import {
	CODE_EXPLORATION_AGENT_DISPLAY_NAME,
	CODE_EXPLORATION_AGENT_NAME,
	CODE_REVIEW_AGENT_DISPLAY_NAME,
	CODE_REVIEW_AGENT_NAME,
	PLANNING_AGENT_DISPLAY_NAME,
	PLANNING_AGENT_NAME
} from '../agent/agents/customAgents.js';
import { logAgentFlow, summarizeText } from '../agent/debugLogger.js';
import type { ChatRun } from '../types/chat';
import type { ChatMessenger } from './chatMessenger.js';
import type { ChatSessionStore } from './sessionStore.js';

/**
 * Tracks subagent runs surfaced by the gateway's session-event stream and mirrors
 * them into the session store + chat webview. Owns the toolCall↔run bookkeeping
 * and the suspend/resume of the main tool-status slot while subagents are active.
 */
export class SubagentRunTracker {
	private readonly activeSubagentRunIds = new Set<string>();
	private readonly subagentRunIdsByParentToolCallId = new Map<string, string>();
	private readonly subagentRunIdsByToolCallId = new Map<string, string>();
	private readonly subagentToolNamesByToolCallId = new Map<string, string>();

	constructor(
		private readonly sessionStore: ChatSessionStore,
		private readonly messenger: ChatMessenger
	) {}

	public getActiveRunCount(): number {
		return this.activeSubagentRunIds.size;
	}

	public resetTracking(): void {
		this.activeSubagentRunIds.clear();
		this.subagentRunIdsByParentToolCallId.clear();
		this.subagentRunIdsByToolCallId.clear();
		this.subagentToolNamesByToolCallId.clear();
	}

	public async finalizeActiveRuns(
		sessionId: string,
		status: 'cancelled' | 'error',
		errorText?: string
	): Promise<void> {
		const activeRunIds = [...this.activeSubagentRunIds];
		logAgentFlow('main.extension.subagent', 'finalize_active_runs', {
			sessionId,
			status,
			activeRunIds,
			errorText
		});

		for (const runId of activeRunIds) {
			const run = this.sessionStore.getRun(sessionId, runId);
			if (!run || run.status !== 'running') {
				continue;
			}

			const elapsedText = Number.isFinite(run.startedAt)
				? this.formatElapsedText(Date.now() - run.startedAt)
				: undefined;

			if (status === 'cancelled') {
				this.sessionStore.finishRun(sessionId, runId, {
					status: 'cancelled',
					elapsedText
				});
			} else {
				this.sessionStore.failRun(sessionId, runId, errorText || 'The main request ended early; the subtask did not finish.', elapsedText);
			}

			await this.postRunState(sessionId, runId);
		}

		this.resetTracking();
		await this.messenger.postToolStatusSuspended(false);
	}

	public async handleSessionEventForUi(sessionId: string, event: SessionEvent): Promise<void> {
		switch (event.type) {
			case 'tool.execution_start':
				await this.handleToolExecutionStart(sessionId, event);
				break;
			case 'tool.execution_progress':
				await this.handleToolExecutionProgress(sessionId, event);
				break;
			case 'tool.execution_complete':
				await this.handleToolExecutionComplete(sessionId, event);
				break;
			case 'subagent.started':
				await this.handleSubagentStarted(sessionId, event);
				break;
			case 'subagent.completed':
				await this.handleSubagentCompleted(sessionId, event);
				break;
			case 'subagent.failed':
				await this.handleSubagentFailed(sessionId, event);
				break;
			default:
				break;
		}
	}

	public async handleSubagentAssistantDelta(
		sessionId: string,
		parentToolCallId: string,
		text: string
	): Promise<void> {
		if (!text) {
			return;
		}

		const runId = this.subagentRunIdsByParentToolCallId.get(parentToolCallId);
		if (!runId) {
			logAgentFlow('main.extension.subagent', 'assistant_delta:run_missing', {
				sessionId,
				parentToolCallId,
				textLength: text.length,
				textPreview: summarizeText(text)
			});
			return;
		}

		logAgentFlow('main.extension.subagent', 'assistant_delta', {
			sessionId,
			runId,
			parentToolCallId,
			textLength: text.length,
			textPreview: summarizeText(text)
		});
		this.sessionStore.appendRunAssistantDelta(sessionId, runId, text);
		await this.postRunState(sessionId, runId);
	}

	private async postRunState(sessionId: string, runId: string): Promise<void> {
		const run = this.sessionStore.getRun(sessionId, runId);
		if (run) {
			await this.messenger.postRunState(sessionId, run);
		}
	}

	private async handleToolExecutionStart(
		sessionId: string,
		event: Extract<SessionEvent, { type: 'tool.execution_start' }>
	): Promise<void> {
		const toolName = event.data.toolName ?? 'unknown_tool';
		const parentToolCallId = event.data.parentToolCallId;
		const runId = parentToolCallId ? this.subagentRunIdsByParentToolCallId.get(parentToolCallId) : undefined;

		logAgentFlow('main.extension', 'callback:onToolStart', {
			sessionId,
			toolName,
			toolCallId: event.data.toolCallId,
			parentToolCallId,
			runId,
			activeSubagentRuns: this.activeSubagentRunIds.size
		});

		if (runId) {
			this.subagentRunIdsByToolCallId.set(event.data.toolCallId, runId);
			this.subagentToolNamesByToolCallId.set(event.data.toolCallId, toolName);
			this.sessionStore.setRunTransientToolStatus(sessionId, runId, `Calling tool \`${toolName}\`…`);
			await this.postRunState(sessionId, runId);
			return;
		}

		if (this.activeSubagentRunIds.size > 0) {
			return;
		}

		await this.messenger.postToolStatus(`Calling tool \`${toolName}\`…`, true);
	}

	private async handleToolExecutionProgress(
		sessionId: string,
		event: Extract<SessionEvent, { type: 'tool.execution_progress' }>
	): Promise<void> {
		const runId = this.subagentRunIdsByToolCallId.get(event.data.toolCallId);
		if (!runId) {
			return;
		}
		this.sessionStore.appendRunProgress(sessionId, runId, event.data.progressMessage);
		await this.postRunState(sessionId, runId);
	}

	private async handleToolExecutionComplete(
		sessionId: string,
		event: Extract<SessionEvent, { type: 'tool.execution_complete' }>
	): Promise<void> {
		const runId = this.subagentRunIdsByToolCallId.get(event.data.toolCallId);
		const toolName = this.subagentToolNamesByToolCallId.get(event.data.toolCallId);

		logAgentFlow('main.extension', 'callback:onToolEnd', {
			sessionId,
			toolCallId: event.data.toolCallId,
			toolName,
			runId,
			success: event.data.success,
			activeSubagentRuns: this.activeSubagentRunIds.size
		});

		if (runId) {
			if (toolName === 'update_progress') {
				const progressText = this.extractProgressFromToolResult(event);
				if (progressText) {
					this.sessionStore.appendRunProgress(sessionId, runId, progressText);
				}
			}
			this.subagentRunIdsByToolCallId.delete(event.data.toolCallId);
			this.subagentToolNamesByToolCallId.delete(event.data.toolCallId);
			this.sessionStore.clearRunTransientToolStatus(sessionId, runId);
			await this.postRunState(sessionId, runId);
			return;
		}

		this.subagentToolNamesByToolCallId.delete(event.data.toolCallId);

		if (this.activeSubagentRunIds.size > 0) {
			return;
		}

		await this.messenger.postToolStatusDone();
	}

	private async handleSubagentStarted(
		sessionId: string,
		event: Extract<SessionEvent, { type: 'subagent.started' }>
	): Promise<void> {
		const existingRunId = this.subagentRunIdsByParentToolCallId.get(event.data.toolCallId);
		if (existingRunId) {
			logAgentFlow('main.extension.subagent', 'start:duplicate_ignored', {
				sessionId,
				runId: existingRunId,
				toolCallId: event.data.toolCallId,
				agentName: event.data.agentName
			});
			return;
		}

		const kind: ChatRun['kind'] = event.data.agentName === CODE_REVIEW_AGENT_NAME ? 'code_review' : 'subagent';
		const run = this.sessionStore.startRun(sessionId, {
			title: this.resolveSubagentDisplayName(event.data.agentName, event.data.agentDisplayName),
			kind
		});
		const shouldSuspendMainToolSlot = this.activeSubagentRunIds.size === 0;
		this.activeSubagentRunIds.add(run.id);
		this.subagentRunIdsByParentToolCallId.set(event.data.toolCallId, run.id);
		if (shouldSuspendMainToolSlot) {
			await this.messenger.postToolStatusSuspended(true);
		}
		logAgentFlow('main.extension.subagent', 'start', {
			sessionId,
			runId: run.id,
			toolCallId: event.data.toolCallId,
			agentName: event.data.agentName,
			agentDisplayName: event.data.agentDisplayName,
			activeSubagentRuns: this.activeSubagentRunIds.size
		});
		await this.postRunState(sessionId, run.id);
	}

	private async handleSubagentCompleted(
		sessionId: string,
		event: Extract<SessionEvent, { type: 'subagent.completed' }>
	): Promise<void> {
		const runId = this.subagentRunIdsByParentToolCallId.get(event.data.toolCallId);
		if (!runId) {
			return;
		}
		this.subagentRunIdsByParentToolCallId.delete(event.data.toolCallId);
		this.activeSubagentRunIds.delete(runId);
		if (this.activeSubagentRunIds.size === 0) {
			await this.messenger.postToolStatusSuspended(false);
		}
		const elapsedText = this.formatElapsedText(event.data.durationMs);
		const run = this.sessionStore.getRun(sessionId, runId);
		const finalAssistantText = run?.activeAssistantText.trim()
			? undefined
			: this.resolveSubagentCompletionText(event.data.agentName, event.data.agentDisplayName);
		logAgentFlow('main.extension.subagent', 'finish', {
			sessionId,
			runId,
			toolCallId: event.data.toolCallId,
			agentName: event.data.agentName,
			elapsedText,
			activeSubagentRuns: this.activeSubagentRunIds.size
		});
		this.sessionStore.finishRun(sessionId, runId, {
			elapsedText,
			finalAssistantText
		});
		await this.postRunState(sessionId, runId);
	}

	private async handleSubagentFailed(
		sessionId: string,
		event: Extract<SessionEvent, { type: 'subagent.failed' }>
	): Promise<void> {
		const runId = this.subagentRunIdsByParentToolCallId.get(event.data.toolCallId);
		if (!runId) {
			return;
		}
		this.subagentRunIdsByParentToolCallId.delete(event.data.toolCallId);
		this.activeSubagentRunIds.delete(runId);
		if (this.activeSubagentRunIds.size === 0) {
			await this.messenger.postToolStatusSuspended(false);
		}
		const elapsedText = this.formatElapsedText(event.data.durationMs);
		logAgentFlow('main.extension.subagent', 'error', {
			sessionId,
			runId,
			toolCallId: event.data.toolCallId,
			agentName: event.data.agentName,
			message: event.data.error,
			elapsedText,
			activeSubagentRuns: this.activeSubagentRunIds.size
		});
		this.sessionStore.failRun(sessionId, runId, event.data.error, elapsedText);
		await this.postRunState(sessionId, runId);
	}

	private formatElapsedText(durationMs: number | undefined): string | undefined {
		if (!Number.isFinite(durationMs)) {
			return undefined;
		}
		return `Elapsed: ${((durationMs as number) / 1000).toFixed(2)}s`;
	}

	private resolveSubagentDisplayName(agentName: string | undefined, agentDisplayName: string | undefined): string {
		const explicitDisplayName = agentDisplayName?.trim();
		if (explicitDisplayName) {
			return explicitDisplayName;
		}

		switch (agentName) {
			case CODE_REVIEW_AGENT_NAME:
				return CODE_REVIEW_AGENT_DISPLAY_NAME;
			case PLANNING_AGENT_NAME:
				return PLANNING_AGENT_DISPLAY_NAME;
			case CODE_EXPLORATION_AGENT_NAME:
				return CODE_EXPLORATION_AGENT_DISPLAY_NAME;
			default:
				return 'Sub Agent';
		}
	}

	private resolveSubagentCompletionText(agentName: string | undefined, agentDisplayName: string | undefined): string {
		if (agentName === CODE_REVIEW_AGENT_NAME) {
			return 'The task-review subagent finished.';
		}

		return `${this.resolveSubagentDisplayName(agentName, agentDisplayName)} finished.`;
	}

	private extractProgressFromToolResult(
		event: Extract<SessionEvent, { type: 'tool.execution_complete' }>
	): string | undefined {
		const rawResult = (event.data as { result?: { content?: string; detailedContent?: string } }).result;
		const content = (rawResult?.detailedContent ?? rawResult?.content ?? '').trim();
		if (!content) {
			return undefined;
		}

		try {
			const parsed = JSON.parse(content) as { text?: string };
			const text = (parsed.text ?? '').trim();
			return text || undefined;
		} catch {
			return undefined;
		}
	}
}
