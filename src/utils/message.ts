/**
 * Content that may be a plain string, or an array of content blocks
 * (text / image_url / etc.).  This replaces the former LangChain
 * `MessageContent` type with an equivalent local definition.
 */
export type MessageContent =
	| string
	| Array<
		| string
		| { type: 'text'; text: string }
		| { type: 'image_url'; image_url: { url: string } }
		| { type: string; [key: string]: unknown }
	>;

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
