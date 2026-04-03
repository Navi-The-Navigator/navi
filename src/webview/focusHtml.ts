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
			<button id="focusHelpSelectedBtn" class="focus-footer-btn focus-help-btn" type="button">Help (0/0)</button>
			<button id="focusReviewSelectedBtn" class="focus-footer-btn focus-review-btn" type="button">Review (0/0)</button>
		</div>
	</div>
	<script src="${scriptUri}"></script>
</body>
</html>`;
}
