type ChatFocusTarget = {
	id: string;
	sessionId: string;
	path: string;
	startLine: number;
	endLine: number;
	title: string;
	instruction: string;
	updatedAt: number;
};

type FocusStateMessage = {
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

const vscode = acquireVsCodeApi();
const focusSummary = requireElement<HTMLDivElement>('#focusSummary');
const focusList = requireElement<HTMLDivElement>('#focusList');
const focusPrevBtn = requireElement<HTMLButtonElement>('#focusPrevBtn');
const focusNextBtn = requireElement<HTMLButtonElement>('#focusNextBtn');
const focusReviewSelectedBtn = requireElement<HTMLButtonElement>('#focusReviewSelectedBtn');
const focusHelpSelectedBtn = requireElement<HTMLButtonElement>('#focusHelpSelectedBtn');

let currentSessionId = '';
let activeIndex = -1;
let focusTargets: ChatFocusTarget[] = [];
let selectedTargetIds = new Set<string>();

function requireElement<T extends Element>(selector: string): T {
	const element = document.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Missing required element: ${selector}`);
	}
	return element;
}

function getSelectedTargetIds(): string[] {
	return focusTargets.filter((target) => selectedTargetIds.has(target.id)).map((target) => target.id);
}

function refreshFooter(): void {
	const selectedCount = getSelectedTargetIds().length;
	const totalCount = focusTargets.length;
	focusReviewSelectedBtn.textContent = `Review (${selectedCount}/${totalCount})`;
	focusHelpSelectedBtn.textContent = `Help (${selectedCount}/${totalCount})`;
	focusReviewSelectedBtn.disabled = selectedCount === 0;
	focusHelpSelectedBtn.disabled = selectedCount === 0;
}

function render(): void {
	focusList.innerHTML = '';
	selectedTargetIds = new Set(
		Array.from(selectedTargetIds).filter((id) => focusTargets.some((target) => target.id === id))
	);
	if (!Array.isArray(focusTargets) || focusTargets.length === 0) {
		focusSummary.textContent = '暂无高亮区域';
		focusPrevBtn.disabled = true;
		focusNextBtn.disabled = true;
		refreshFooter();
		return;
	}

	focusSummary.textContent = `当前会话 ${focusTargets.length} 个高亮区域，当前第 ${activeIndex + 1} 个`;
	focusPrevBtn.disabled = focusTargets.length <= 1;
	focusNextBtn.disabled = focusTargets.length <= 1;

	focusTargets.forEach((target, index) => {
		const card = document.createElement('div');
		card.className = 'focus-target-card';
		if (index === activeIndex) {
			card.classList.add('focus-target-card-active');
		}

		const topRow = document.createElement('div');
		topRow.className = 'focus-target-top-row';

		const title = document.createElement('div');
		title.className = 'focus-target-title';
		title.textContent = target.title || '待编辑区域';

		const toggleWrap = document.createElement('label');
		toggleWrap.className = 'focus-target-checkbox-wrap';

		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.checked = selectedTargetIds.has(target.id);
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) {
				selectedTargetIds.add(target.id);
			} else {
				selectedTargetIds.delete(target.id);
			}
			refreshFooter();
		});

		toggleWrap.appendChild(checkbox);
		topRow.appendChild(title);
		topRow.appendChild(toggleWrap);

		const location = document.createElement('div');
		location.className = 'focus-target-location';
		location.textContent = `${target.path} · L${target.startLine} - L${target.endLine}`;

		const instruction = document.createElement('div');
		instruction.className = 'focus-target-instruction';
		instruction.textContent = target.instruction || '请在该区域继续当前任务。';

		const actionRow = document.createElement('div');
		actionRow.className = 'focus-target-action-row';

		const jumpButton = document.createElement('button');
		jumpButton.type = 'button';
		jumpButton.className = 'focus-target-jump';
		jumpButton.textContent = '跳转';
		jumpButton.addEventListener('click', () => {
			vscode.postMessage({
				type: 'focus:revealById',
				sessionId: currentSessionId,
				focusTargetId: target.id
			});
		});

		const helpButton = document.createElement('button');
		helpButton.type = 'button';
		helpButton.className = 'focus-target-jump focus-help-btn';
		helpButton.textContent = 'Help';
		helpButton.addEventListener('click', () => {
			vscode.postMessage({
				type: 'focus:helpById',
				sessionId: currentSessionId,
				focusTargetId: target.id
			});
		});

		const reviewButton = document.createElement('button');
		reviewButton.type = 'button';
		reviewButton.className = 'focus-target-jump focus-review-btn';
		reviewButton.textContent = 'Review';
		reviewButton.addEventListener('click', () => {
			vscode.postMessage({
				type: 'focus:reviewById',
				sessionId: currentSessionId,
				focusTargetId: target.id
			});
		});

		actionRow.appendChild(jumpButton);
		actionRow.appendChild(helpButton);
		actionRow.appendChild(reviewButton);
		card.appendChild(topRow);
		card.appendChild(location);
		card.appendChild(instruction);
		card.appendChild(actionRow);
		focusList.appendChild(card);
	});
	refreshFooter();
}

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
	vscode.postMessage({ type: 'focus:reviewSelected', sessionId: currentSessionId, focusTargetIds });
});

focusHelpSelectedBtn.addEventListener('click', () => {
	const focusTargetIds = getSelectedTargetIds();
	if (focusTargetIds.length === 0) {
		return;
	}
	vscode.postMessage({ type: 'focus:helpSelected', sessionId: currentSessionId, focusTargetIds });
});

window.addEventListener('message', (event: MessageEvent<FocusStateMessage>) => {
	const message = event.data || {};
	if (message.type !== 'focus:state') {
		return;
	}
	currentSessionId = message.sessionId || '';
	activeIndex = typeof message.activeIndex === 'number' && Number.isFinite(message.activeIndex) ? message.activeIndex : -1;
	focusTargets = Array.isArray(message.focusTargets) ? message.focusTargets : [];
	render();
});

vscode.postMessage({ type: 'focus:ready' });