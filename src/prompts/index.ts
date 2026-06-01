import type { ChatFocusTarget } from '../types/chat';
import {
	CODE_EXPLORATION_AGENT_SYSTEM_PROMPT,
	CODE_REVIEW_AGENT_SYSTEM_PROMPT,
	PLANNING_AGENT_SYSTEM_PROMPT
} from './agents.js';
import { SYSTEM_PROMPT, buildFocusActionPrompt, type FocusAction } from './main.js';

export { SYSTEM_PROMPT, buildFocusActionPrompt } from './main.js';
export type { FocusAction } from './main.js';
export {
	CODE_EXPLORATION_AGENT_SYSTEM_PROMPT,
	CODE_REVIEW_AGENT_SYSTEM_PROMPT,
	PLANNING_AGENT_SYSTEM_PROMPT
} from './agents.js';
export { SECTION_RULE, composeSections } from './fragments.js';

/** Identifier for a built-in sub-agent system prompt. */
export type PromptId = 'codeExploration' | 'codeReview' | 'planning';

const AGENT_PROMPTS: Record<PromptId, string> = {
	codeExploration: CODE_EXPLORATION_AGENT_SYSTEM_PROMPT,
	codeReview: CODE_REVIEW_AGENT_SYSTEM_PROMPT,
	planning: PLANNING_AGENT_SYSTEM_PROMPT
};

/** Return a sub-agent system prompt by id. */
export function agentPrompt(id: PromptId): string {
	return AGENT_PROMPTS[id];
}

export type FocusActionContext = { targets: ChatFocusTarget[]; action: FocusAction };

/**
 * Single entry point for loading top-level prompts. Sub-agent prompts are
 * loaded via {@link agentPrompt}.
 */
export function loadPrompt(id: 'system'): string;
export function loadPrompt(id: 'focusAction', ctx: FocusActionContext): { preview: string; prompt: string };
export function loadPrompt(
	id: 'system' | 'focusAction',
	ctx?: FocusActionContext
): string | { preview: string; prompt: string } {
	if (id === 'system') {
		return SYSTEM_PROMPT;
	}
	if (!ctx) {
		throw new Error('loadPrompt("focusAction") requires a focus-action context.');
	}
	return buildFocusActionPrompt(ctx.targets, ctx.action);
}
