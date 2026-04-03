import type { ChatRunKind } from '../types/chat';

export type SubagentTraceStartInput = {
	title: string;
	kind: ChatRunKind;
	parentRunId?: string;
	request?: string;
	paths?: string[];
	metadata?: Record<string, unknown>;
};

export type SubagentTraceFinishPayload = {
	finalText: string;
	elapsedText: string;
};

export type SubagentTraceErrorPayload = {
	message: string;
	elapsedText: string;
};

export type SubagentTraceCallbacks = {
	start?: (input: SubagentTraceStartInput) => Promise<string | undefined> | string | undefined;
	onProgress?: (runId: string, text: string) => Promise<void> | void;
	onToolStart?: (runId: string, toolName: string) => Promise<void> | void;
	onToolEnd?: (runId: string, toolName?: string) => Promise<void> | void;
	onAssistantDelta?: (runId: string, delta: string) => Promise<void> | void;
	onFinish?: (runId: string, payload: SubagentTraceFinishPayload) => Promise<void> | void;
	onError?: (runId: string, payload: SubagentTraceErrorPayload) => Promise<void> | void;
	getAbortSignal?: () => AbortSignal | undefined;
};