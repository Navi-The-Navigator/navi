import type { MessageContent } from '@langchain/core/messages';

export function extractMessageText(content?: MessageContent): string {
	if (typeof content === 'string') {
		return content;
	}

	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === 'string') {
					return part;
				}
				if (part.type === 'text') {
					return part.text;
				}
				return '';
			})
			.filter(Boolean)
			.join('');
	}

	return '';
}

export function getMessageType(message: unknown): string | undefined {
	if (!message || typeof message !== 'object') {
		return undefined;
	}

	const typed = message as {
		_getType?: () => string;
		type?: string;
	};

	if (typeof typed._getType === 'function') {
		return typed._getType();
	}

	return typed.type;
}
