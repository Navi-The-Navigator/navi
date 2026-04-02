import * as assert from 'assert';
import * as vscode from 'vscode';
import { getFocusHtml } from '../webview/focusHtml';

suite('getFocusHtml', () => {
	test('renders standalone focus webview shell and actions', () => {
		const webview = {
			cspSource: 'vscode-webview://test-source',
			asWebviewUri: (uri: vscode.Uri) => vscode.Uri.parse(`webview:${uri.path}`)
		} as unknown as vscode.Webview;
		const extensionUri = vscode.Uri.file('/tmp/navi-extension');

		const html = getFocusHtml(webview, extensionUri);
		const nonceMatch = html.match(/script-src 'nonce-([^']+)'/);

		assert.ok(nonceMatch);
		assert.ok(html.includes('<title>Navi Focus</title>'));
		assert.ok(html.includes('id="focusList"'));
		assert.ok(html.includes('id="focusSummary"'));
		assert.ok(html.includes('id="focusPrevBtn"'));
		assert.ok(html.includes('id="focusNextBtn"'));
		assert.ok(html.includes('id="focusReviewSelectedBtn"'));
		assert.ok(html.includes('id="focusHelpSelectedBtn"'));
		assert.ok(html.includes('id="focusProceedBtn"'));
		assert.ok(html.includes("type: 'focus:prev'"));
		assert.ok(html.includes("type: 'focus:next'"));
		assert.ok(html.includes("type: 'focus:revealById'"));
		assert.ok(html.includes("type: 'focus:reviewById'"));
		assert.ok(html.includes("type: 'focus:helpById'"));
		assert.ok(html.includes("type: 'focus:reviewSelected'"));
		assert.ok(html.includes("type: 'focus:helpSelected'"));
		assert.ok(html.includes("type: 'focus:proceedSelected'"));
		assert.ok(html.includes('checkbox.type = \'checkbox\''));
		assert.ok(!html.includes("type: 'focus:clearById'"));
		assert.ok(html.includes("if (message.type !== 'focus:state')"));
		assert.ok(html.includes("vscode.postMessage({ type: 'focus:ready' });"));
	});
});
