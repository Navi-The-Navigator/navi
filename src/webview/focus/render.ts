import {
	T,
	vscode,
	focusSummary,
	focusList,
	focusPrevBtn,
	focusNextBtn,
	focusReviewSelectedBtn,
	focusHelpSelectedBtn,
	state
} from './state.js';

export function getSelectedTargetIds(): string[] {
	return state.focusTargets
		.filter((target) => state.selectedTargetIds.has(target.id))
		.map((target) => target.id);
}

export function refreshFooter(): void {
	const selectedCount = getSelectedTargetIds().length;
	const totalCount = state.focusTargets.length;
	focusReviewSelectedBtn.textContent = `Review (${selectedCount}/${totalCount})`;
	focusHelpSelectedBtn.textContent = `Help (${selectedCount}/${totalCount})`;
	focusReviewSelectedBtn.disabled = selectedCount === 0;
	focusHelpSelectedBtn.disabled = selectedCount === 0;
}

export function render(): void {
	focusList.innerHTML = '';
	state.selectedTargetIds = new Set(
		Array.from(state.selectedTargetIds).filter((id) => state.focusTargets.some((target) => target.id === id))
	);
	if (!Array.isArray(state.focusTargets) || state.focusTargets.length === 0) {
		focusSummary.textContent = T.emptySummary;
		focusPrevBtn.disabled = true;
		focusNextBtn.disabled = true;
		refreshFooter();
		return;
	}

	focusSummary.textContent = T.summary(state.focusTargets.length, state.activeIndex + 1);
	focusPrevBtn.disabled = state.focusTargets.length <= 1;
	focusNextBtn.disabled = state.focusTargets.length <= 1;

	state.focusTargets.forEach((target, index) => {
		const card = document.createElement('div');
		card.className = 'focus-target-card';
		if (index === state.activeIndex) {
			card.classList.add('focus-target-card-active');
		}

		const topRow = document.createElement('div');
		topRow.className = 'focus-target-top-row';

		const title = document.createElement('div');
		title.className = 'focus-target-title';
		title.textContent = target.title || T.untitledRegion;

		const toggleWrap = document.createElement('label');
		toggleWrap.className = 'focus-target-checkbox-wrap';

		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.checked = state.selectedTargetIds.has(target.id);
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) {
				state.selectedTargetIds.add(target.id);
			} else {
				state.selectedTargetIds.delete(target.id);
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
		instruction.textContent = target.instruction || T.defaultInstruction;

		const actionRow = document.createElement('div');
		actionRow.className = 'focus-target-action-row';

		const titleLabel = title.textContent || T.untitledRegion;
		const locationLabel = location.textContent || '';

		const jumpButton = document.createElement('button');
		jumpButton.type = 'button';
		jumpButton.className = 'focus-target-jump';
		jumpButton.textContent = T.jump;
		jumpButton.setAttribute('aria-label', T.jumpAria(titleLabel, locationLabel));
		jumpButton.addEventListener('click', () => {
			vscode.postMessage({
				type: 'focus:revealById',
				sessionId: state.currentSessionId,
				focusTargetId: target.id
			});
		});

		const helpButton = document.createElement('button');
		helpButton.type = 'button';
		helpButton.className = 'focus-target-jump focus-help-btn';
		helpButton.textContent = T.help;
		helpButton.setAttribute('aria-label', T.helpAria(titleLabel));
		helpButton.addEventListener('click', () => {
			vscode.postMessage({
				type: 'focus:helpById',
				sessionId: state.currentSessionId,
				focusTargetId: target.id
			});
		});

		const reviewButton = document.createElement('button');
		reviewButton.type = 'button';
		reviewButton.className = 'focus-target-jump focus-review-btn';
		reviewButton.textContent = T.review;
		reviewButton.setAttribute('aria-label', T.reviewAria(titleLabel));
		reviewButton.addEventListener('click', () => {
			vscode.postMessage({
				type: 'focus:reviewById',
				sessionId: state.currentSessionId,
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
