import type { NaviTool } from '../naviTool';

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
			const input = parseInput(rawInput);
			const text = buildProgressText(input);
			if (!text) {
				return JSON.stringify({ ok: false, error: 'Progress text is required.' }, null, 2);
			}

			await deps.onProgress(text);
			return JSON.stringify({ ok: true, text }, null, 2);
		}
	};
}

function parseInput(rawInput: string): UpdateProgressInput {
	const text = rawInput.trim();
	if (!text) {
		return {};
	}

	if (text.startsWith('{')) {
		try {
			return JSON.parse(text) as UpdateProgressInput;
		} catch {
			return { text };
		}
	}

	return { text };
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