import { vscode, focusPrevBtn, focusNextBtn, focusReviewSelectedBtn, focusHelpSelectedBtn, state } from './state.js';
import type { FocusStateMessage } from './state.js';
import { getSelectedTargetIds, render } from './render.js';

focusPrevBtn.addEventListener('click', () => {
	vscode.postMessage({ type: 'focus:prev' });
});

focusNextBtn.addEventListener('click', () => {
	vscode.postMessage({ type: 'focus:next' });
});

focusReviewSelectedBtn.addEventListener('click', () => {
	const focusTargetIds = getSelectedTargetIds();
	if (focusTargetIds.length === 0) {
		return;
	}
	vscode.postMessage({ type: 'focus:reviewSelected', sessionId: state.currentSessionId, focusTargetIds });
});

focusHelpSelectedBtn.addEventListener('click', () => {
	const focusTargetIds = getSelectedTargetIds();
	if (focusTargetIds.length === 0) {
		return;
	}
	vscode.postMessage({ type: 'focus:helpSelected', sessionId: state.currentSessionId, focusTargetIds });
});

window.addEventListener('message', (event: MessageEvent<FocusStateMessage>) => {
	const message = event.data || {};
	if (message.type !== 'focus:state') {
		return;
	}
	state.currentSessionId = message.sessionId || '';
	state.activeIndex = typeof message.activeIndex === 'number' && Number.isFinite(message.activeIndex) ? message.activeIndex : -1;
	state.focusTargets = Array.isArray(message.focusTargets) ? message.focusTargets : [];
	render();
});

vscode.postMessage({ type: 'focus:ready' });
