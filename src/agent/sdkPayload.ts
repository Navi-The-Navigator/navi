/**
 * Defensive extraction of assistant text from the SDK's (loosely-typed)
 * message payloads. Isolated here so all SDK-shape fragility lives in one file.
 */

export function extractAssistantMessageText(data: unknown): string {
	if (!data || typeof data !== 'object') {
		return '';
	}

	const root = data as Record<string, unknown>;
	const direct = extractTextFromContentLike(root.content);
	if (direct) {
		return direct;
	}

	const fromMessage = extractTextFromContentLike((root.message as Record<string, unknown> | undefined)?.content);
	if (fromMessage) {
		return fromMessage;
	}

	const textLike = [root.text, root.markdown, root.contentText]
		.filter((item) => typeof item === 'string')
		.join('\n')
		.trim();
	if (textLike) {
		return textLike;
	}

	return '';
}

export function extractTextFromContentLike(content: unknown): string {
	if (!content) {
		return '';
	}

	if (typeof content === 'string') {
		return content.trim();
	}

	if (!Array.isArray(content)) {
		return '';
	}

	const texts = content
		.map((item) => {
			if (!item || typeof item !== 'object') {
				return '';
			}
			const record = item as Record<string, unknown>;
			if (typeof record.text === 'string') {
				return record.text;
			}
			const nestedText = record.text as Record<string, unknown> | undefined;
			if (nestedText && typeof nestedText.content === 'string') {
				return nestedText.content;
			}
			return '';
		})
		.filter(Boolean)
		.join('\n')
		.trim();

	return texts;
}
