import type { NaviTool } from '../naviTool';
import { errorResult, parseInput, successResult } from './_shared.js';

type UpdateProgressInput = {
	text?: string;
	stage?: string;
	status?: string;
};

type UpdateProgressDeps = {
	onProgress: (text: string) => Promise<void> | void;
};

export function createUpdateProgressTool(deps: UpdateProgressDeps): NaviTool {
	return {
		name: 'update_progress',
		description:
			'Post a short progress update to the chat area. Input can be plain text or JSON: {text, stage?, status?}.',
		func: async (rawInput: string) => {
			const input = parseInput<UpdateProgressInput>(rawInput, (text) => ({ text }));
			const text = buildProgressText(input);
			if (!text) {
				return errorResult('Progress text is required.');
			}

			await deps.onProgress(text);
			return successResult({ text });
		}
	};
}

function buildProgressText(input: UpdateProgressInput): string {
	const text = (input.text ?? '').trim();
	const stage = (input.stage ?? '').trim();
	const status = (input.status ?? '').trim();

	if (!text) {
		return '';
	}

	if (!stage && !status) {
		return text;
	}

	const prefixParts = [stage, status].filter((part) => !!part);
	return `[${prefixParts.join(' | ')}] ${text}`;
}
