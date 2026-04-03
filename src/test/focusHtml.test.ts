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
		assert.ok(html.includes('<title>Navi Focus</title>'));
		assert.ok(html.includes('id="focusList"'));
		assert.ok(html.includes('id="focusSummary"'));
		assert.ok(html.includes('id="focusPrevBtn"'));
		assert.ok(html.includes('id="focusNextBtn"'));
		assert.ok(html.includes('id="focusReviewSelectedBtn"'));
		assert.ok(html.includes('id="focusHelpSelectedBtn"'));
		assert.ok(!html.includes('Proceed Anyway'));
		assert.ok(!html.includes("type: 'focus:clearById'"));
		assert.ok(html.includes('webview:/tmp/navi-extension/media/sidebar.css'));
		assert.ok(html.includes('webview:/tmp/navi-extension/dist/focusApp.js'));
		assert.ok(html.includes('style-src vscode-webview://test-source; script-src vscode-webview://test-source;'));
		assert.ok(html.includes('<script src="webview:/tmp/navi-extension/dist/focusApp.js"></script>'));
	});
});
