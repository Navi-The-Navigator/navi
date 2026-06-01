// View-state, shared DOM references and the VS Code bridge for the focus webview.

export type ChatFocusTarget = {
	id: string;
	sessionId: string;
	path: string;
	startLine: number;
	endLine: number;
	title: string;
	instruction: string;
	updatedAt: number;
};

export type FocusStateMessage = {
	type?: string;
	sessionId?: string;
	activeIndex?: number;
	focusTargets?: ChatFocusTarget[];
};

declare function acquireVsCodeApi(): {
	postMessage(message: unknown): void;
	setState?(state: unknown): void;
	getState?(): unknown;
};

// User-facing strings, centralized for easy future localization.
export const T = {
	emptySummary: 'No focus regions yet',
	summary: (total: number, current: number) => `${total} focus regions · viewing ${current} of ${total}`,
	untitledRegion: 'Untitled region',
	defaultInstruction: 'Continue the current task in this region.',
	jump: 'Jump',
	help: 'Help',
	review: 'Review',
	jumpAria: (title: string, location: string) => `Jump to ${title}, ${location}`,
	helpAria: (title: string) => `Get help on ${title}`,
	reviewAria: (title: string) => `Mark ${title} for review`
} as const;

export const vscode = acquireVsCodeApi();

export function requireElement<T extends Element>(selector: string): T {
	const element = document.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Missing required element: ${selector}`);
	}
	return element;
}

export const focusSummary = requireElement<HTMLDivElement>('#focusSummary');
export const focusList = requireElement<HTMLDivElement>('#focusList');
export const focusPrevBtn = requireElement<HTMLButtonElement>('#focusPrevBtn');
export const focusNextBtn = requireElement<HTMLButtonElement>('#focusNextBtn');
export const focusReviewSelectedBtn = requireElement<HTMLButtonElement>('#focusReviewSelectedBtn');
export const focusHelpSelectedBtn = requireElement<HTMLButtonElement>('#focusHelpSelectedBtn');

// Single mutable view-state object shared by render.ts and view.ts.
export const state = {
	currentSessionId: '',
	activeIndex: -1,
	focusTargets: [] as ChatFocusTarget[],
	selectedTargetIds: new Set<string>()
};
