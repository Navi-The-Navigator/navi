import * as vscode from 'vscode';
import { getNonce } from '../utils/id';

export function getFocusHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const nonce = getNonce();
	const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.css'));
	return String.raw`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
	<title>Navi Focus</title>
	<link rel="stylesheet" href="${stylesUri}" />
</head>
<body class="focus-body">
	<div class="focus-page">
		<div class="focus-page-header">
			<div class="focus-page-title">Focus Regions</div>
			<div class="focus-page-actions">
				<button id="focusPrevBtn" class="focus-nav-btn" type="button" aria-label="上一处">
					<span class="focus-nav-icon">◀</span>
					<span class="focus-nav-text">上一处</span>
				</button>
				<button id="focusNextBtn" class="focus-nav-btn" type="button" aria-label="下一处">
					<span class="focus-nav-text">下一处</span>
					<span class="focus-nav-icon">▶</span>
				</button>
			</div>
		</div>
		<div id="focusSummary" class="focus-page-summary">暂无高亮区域</div>
		<div id="focusList" class="focus-page-list"></div>
		<div class="focus-page-footer">
			<button id="focusReviewSelectedBtn" class="focus-footer-btn" type="button">Review (0/0)</button>
			<button id="focusHelpSelectedBtn" class="focus-footer-btn" type="button">Help (0/0)</button>
			<button id="focusProceedBtn" class="focus-footer-btn primary" type="button">Proceed Anyway</button>
		</div>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const focusSummary = document.getElementById('focusSummary');
		const focusList = document.getElementById('focusList');
		const focusPrevBtn = document.getElementById('focusPrevBtn');
		const focusNextBtn = document.getElementById('focusNextBtn');
		const focusReviewSelectedBtn = document.getElementById('focusReviewSelectedBtn');
		const focusHelpSelectedBtn = document.getElementById('focusHelpSelectedBtn');
		const focusProceedBtn = document.getElementById('focusProceedBtn');

		let currentSessionId = '';
		let activeIndex = -1;
		let focusTargets = [];
		let selectedTargetIds = new Set();

		function getSelectedTargetIds() {
			return focusTargets.filter((target) => selectedTargetIds.has(target.id)).map((target) => target.id);
		}

		function refreshFooter() {
			const selectedCount = getSelectedTargetIds().length;
			const totalCount = focusTargets.length;
			focusReviewSelectedBtn.textContent = 'Review (' + selectedCount + '/' + totalCount + ')';
			focusHelpSelectedBtn.textContent = 'Help (' + selectedCount + '/' + totalCount + ')';
			focusReviewSelectedBtn.disabled = selectedCount === 0;
			focusHelpSelectedBtn.disabled = selectedCount === 0;
			focusProceedBtn.disabled = selectedCount === 0;
		}

		function render() {
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

			focusSummary.textContent = '当前会话 ' + focusTargets.length + ' 个高亮区域，当前第 ' + (activeIndex + 1) + ' 个';
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
				location.textContent = target.path + ' · L' + target.startLine + ' - L' + target.endLine;

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

				const reviewButton = document.createElement('button');
				reviewButton.type = 'button';
				reviewButton.className = 'focus-target-jump';
				reviewButton.textContent = 'Review';
				reviewButton.addEventListener('click', () => {
					vscode.postMessage({
						type: 'focus:reviewById',
						sessionId: currentSessionId,
						focusTargetId: target.id
					});
				});

				const helpButton = document.createElement('button');
				helpButton.type = 'button';
				helpButton.className = 'focus-target-jump';
				helpButton.textContent = 'Help';
				helpButton.addEventListener('click', () => {
					vscode.postMessage({
						type: 'focus:helpById',
						sessionId: currentSessionId,
						focusTargetId: target.id
					});
				});

				actionRow.appendChild(jumpButton);
				actionRow.appendChild(reviewButton);
				actionRow.appendChild(helpButton);
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

		focusProceedBtn.addEventListener('click', () => {
			const focusTargetIds = getSelectedTargetIds();
			if (focusTargetIds.length === 0) {
				return;
			}
			vscode.postMessage({ type: 'focus:proceedSelected', sessionId: currentSessionId, focusTargetIds });
		});

		window.addEventListener('message', (event) => {
			const message = event.data || {};
			if (message.type !== 'focus:state') {
				return;
			}
			currentSessionId = message.sessionId || '';
			activeIndex = Number.isFinite(message.activeIndex) ? message.activeIndex : -1;
			focusTargets = Array.isArray(message.focusTargets) ? message.focusTargets : [];
			render();
		});

		vscode.postMessage({ type: 'focus:ready' });
	</script>
</body>
</html>`;
}
