import * as vscode from 'vscode';
import type { SettingsManager } from '../settings/settingsCommands.js';
import { resolveAuthMode, resolveConfiguredApiKey, resolveEnvApiKey } from '../settings/naviConfig.js';

const ENV_API_KEY_CONFIRMED_STATE_KEY = 'navi.confirmedEnvApiKey';

/**
 * Gates the first BYOK message on an available API key: prompts the user to
 * configure one, confirm use of the `NAVI_API_KEY` env var, or switch to
 * Copilot mode. Extracted from GenerationController so that class stays focused
 * on the turn lifecycle.
 */
export class ApiKeyGate {
	constructor(
		private readonly globalState: vscode.Memento,
		private readonly settingsManager: SettingsManager
	) {}

	public async ensureApiKey(): Promise<boolean> {
		const config = vscode.workspace.getConfiguration('navi');
		const authMode = resolveAuthMode(config);

		// Copilot mode: no API key needed (authentication via GitHub)
		if (authMode === 'copilot') {
			return true;
		}

		// BYOK mode: require an API key
		const configuredApiKey = resolveConfiguredApiKey(config);
		if (configuredApiKey) {
			return true;
		}

		const envApiKey = resolveEnvApiKey();
		if (envApiKey) {
			const hasConfirmedEnvApiKey = this.globalState.get<boolean>(ENV_API_KEY_CONFIRMED_STATE_KEY, false);
			if (hasConfirmedEnvApiKey) {
				return true;
			}

			const choice = await vscode.window.showInformationMessage(
				'An API key was found in your environment variables, but none is configured in VS Code. Continue using the environment variable for now?',
				{ modal: true },
				'Use environment variable',
				'Configure key'
			);

			if (choice === 'Use environment variable') {
				await this.globalState.update(ENV_API_KEY_CONFIRMED_STATE_KEY, true);
				return true;
			}

			if (choice === 'Configure key') {
				await this.settingsManager.openApiKeySettings();
				const refreshedApiKey = resolveConfiguredApiKey(config);
				if (refreshedApiKey) {
					return true;
				}
				return false;
			}

			return false;
		}

		const setupChoice = await vscode.window.showWarningMessage(
			'No API key is available for BYOK mode. Configure one now?',
			{ modal: true },
			'Configure key',
			'Switch to Copilot mode'
		);
		if (setupChoice === 'Configure key') {
			await this.settingsManager.openApiKeySettings();
			const updatedApiKey = resolveConfiguredApiKey(config);
			return !!updatedApiKey;
		}
		if (setupChoice === 'Switch to Copilot mode') {
			await config.update('authMode', 'copilot', vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage('Switched to GitHub Copilot mode.');
			return true;
		}
		return false;
	}
}
