import * as vscode from 'vscode';

export function getFocusHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.css'));
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'focusApp.js'));
	return String.raw`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};" />
	<title>Navi Focus</title>
	<link rel="stylesheet" href="${stylesUri}" />
</head>
<body class="focus-body">
	<div class="focus-page">
		<div class="focus-page-header">
			<div class="focus-page-title">Focus Regions</div>
			<div class="focus-page-actions">
				<button id="focusPrevBtn" class="focus-nav-btn" type="button" aria-label="Previous region">
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M7.5 9L4.5 6L7.5 3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
					<span class="focus-nav-text">Prev</span>
				</button>
				<button id="focusNextBtn" class="focus-nav-btn" type="button" aria-label="Next region">
					<span class="focus-nav-text">Next</span>
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
			</div>
		</div>
		<div id="focusSummary" class="focus-page-summary">No focus regions yet</div>
		<div id="focusList" class="focus-page-list"></div>
		<div class="focus-page-footer">
			<button id="focusHelpSelectedBtn" class="focus-footer-btn focus-help-btn" type="button">Help (0/0)</button>
			<button id="focusReviewSelectedBtn" class="focus-footer-btn focus-review-btn" type="button">Review (0/0)</button>
		</div>
	</div>
	<script src="${scriptUri}"></script>
</body>
</html>`;
}
