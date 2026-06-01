import * as vscode from 'vscode';
import type { ChatFocusTarget } from '../types/chat';

/**
 * Owns the three focus-region status-bar items (switcher + prev/next) and keeps
 * their text/tooltip/visibility in sync with the active focus state.
 */
export class FocusStatusBar {
	public static readonly focusSwitcherCommand = 'navi.focusSwitcher';
	public static readonly focusPrevCommand = 'navi.focusPrev';
	public static readonly focusNextCommand = 'navi.focusNext';

	private readonly switcherItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	private readonly prevItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
	private readonly nextItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);

	constructor() {
		this.switcherItem.command = FocusStatusBar.focusSwitcherCommand;
		this.switcherItem.tooltip = 'Switch focus region';
		this.prevItem.command = FocusStatusBar.focusPrevCommand;
		this.prevItem.text = '$(chevron-left)';
		this.prevItem.tooltip = 'Jump to previous focus region';
		this.nextItem.command = FocusStatusBar.focusNextCommand;
		this.nextItem.text = '$(chevron-right)';
		this.nextItem.tooltip = 'Jump to next focus region';
		this.switcherItem.hide();
		this.prevItem.hide();
		this.nextItem.hide();
	}

	public update(targets: ChatFocusTarget[], activeIndex: number, activeTarget: ChatFocusTarget | undefined): void {
		if (targets.length === 0 || !activeTarget) {
			this.switcherItem.text = '$(symbol-event) Navi Focus 0/0';
			this.switcherItem.tooltip = 'No focus regions yet. Click to open the Focus panel.';
			this.switcherItem.show();
			this.prevItem.text = '$(chevron-left)';
			this.prevItem.tooltip = 'No focus regions yet';
			this.prevItem.show();
			this.nextItem.text = '$(chevron-right)';
			this.nextItem.tooltip = 'No focus regions yet';
			this.nextItem.show();
			return;
		}

		this.switcherItem.text = `$(symbol-event) Navi Focus ${activeIndex + 1}/${targets.length}`;
		this.switcherItem.tooltip = `${activeTarget.path}:${activeTarget.startLine}-${activeTarget.endLine}\nClick to switch focus region`;
		this.switcherItem.show();
		this.prevItem.text = '$(chevron-left)';
		this.prevItem.tooltip = 'Jump to previous focus region';
		this.prevItem.show();
		this.nextItem.text = '$(chevron-right)';
		this.nextItem.tooltip = 'Jump to next focus region';
		this.nextItem.show();
	}

	public dispose(): void {
		this.switcherItem.dispose();
		this.prevItem.dispose();
		this.nextItem.dispose();
	}
}
