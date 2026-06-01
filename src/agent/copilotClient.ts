import * as vscode from 'vscode';
import type { CopilotClient } from '@github/copilot-sdk';
import { logAgentFlow } from './debugLogger.js';
import { createCopilotClient } from './modelFactory.js';

/**
 * Owns the single {@link CopilotClient} instance and its lazy, race-guarded
 * initialization. Extracted from the former chatGateway.
 */
export class CopilotClientManager {
	private client?: CopilotClient;
	private clientInitPromise?: Promise<CopilotClient>;

	public async getOrCreateClient(): Promise<CopilotClient> {
		if (this.client) {
			return this.client;
		}
		if (this.clientInitPromise) {
			return this.clientInitPromise;
		}

		this.clientInitPromise = this.initClient();
		try {
			this.client = await this.clientInitPromise;
			return this.client;
		} finally {
			this.clientInitPromise = undefined;
		}
	}

	/**
	 * Stop the client (best-effort) and clear it. When `resetInitPromise` is
	 * true the pending init promise is also cleared (used by invalidateAgent).
	 */
	public async stop(resetInitPromise: boolean): Promise<void> {
		if (this.client) {
			try {
				await this.client.stop();
			} catch {
				// best-effort
			}
			this.client = undefined;
		}
		if (resetInitPromise) {
			this.clientInitPromise = undefined;
		}
	}

	private async initClient(): Promise<CopilotClient> {
		const config = vscode.workspace.getConfiguration('navi');
		logAgentFlow('main.gateway', 'initClient:start');
		const client = await createCopilotClient(config);
		await client.start();
		logAgentFlow('main.gateway', 'initClient:ready');
		return client;
	}
}
