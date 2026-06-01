/**
 * Shared helpers for Navi tools: raw-input parsing + result envelopes.
 * Dedupes the per-tool copies that previously lived in each tool file.
 */

/**
 * Parse a tool's single raw-string input. Returns the parsed object when the
 * text is a JSON object (starts with '{'); otherwise maps the plain text onto a
 * fallback shape via {@link onPlainText}. Empty input yields an empty object.
 * Mirrors the prior per-tool behavior exactly.
 */
export function parseInput<T extends object>(rawInput: string, onPlainText: (text: string) => T): T {
	const text = rawInput.trim();
	if (!text) {
		return {} as T;
	}
	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text) as T;
			return parsed ?? ({} as T);
		} catch {
			return onPlainText(text);
		}
	}
	return onPlainText(text);
}

/** Standard error envelope returned by tools. */
export function errorResult(message: string): string {
	return JSON.stringify({ ok: false, error: message }, null, 2);
}

/** Standard success envelope returned by tools: `{ ok: true, ...data }`. */
export function successResult(data: Record<string, unknown>): string {
	return JSON.stringify({ ok: true, ...data }, null, 2);
}
