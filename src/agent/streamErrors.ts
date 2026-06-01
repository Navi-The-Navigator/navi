/**
 * Stream error classification + the cancellation sentinel.
 *
 * Extracted verbatim from the former chatGateway so retry/normalization policy
 * lives in one place and can be unit-tested without the SDK.
 */

/** Sentinel thrown internally to mark a user-initiated cancellation. */
export const CANCELLED = '__NAVI_CANCELLED__';

export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function shouldRetryStreamError(error: unknown): boolean {
	const message = getErrorMessage(error).toLowerCase();
	if (message.includes('__navi_cancelled__')) {
		return false;
	}
	if (message.includes('aborterror')) {
		return false;
	}
	return (
		message.includes('terminated') ||
		message.includes('abort') ||
		message.includes('aborted') ||
		message.includes('timeout') ||
		message.includes('timed out') ||
		message.includes('econnreset') ||
		message.includes('socket hang up') ||
		message.includes('fetch failed')
	);
}

export function normalizeStreamError(error: unknown): Error {
	const message = getErrorMessage(error);
	const lower = message.toLowerCase();
	if (lower.includes('__navi_cancelled__')) {
		return new Error('Generation cancelled by the user.');
	}
	if (lower.includes('aborterror')) {
		return new Error('Generation cancelled by the user.');
	}
	if (lower.includes('terminated') || lower.includes('abort')) {
		return new Error('The connection was terminated. It was retried once automatically; if it still fails, please retry or reduce the task complexity.');
	}
	if (lower.includes('timeout') || lower.includes('timed out')) {
		return new Error('The request timed out. Please retry, or break it into smaller steps.');
	}
	return error instanceof Error ? error : new Error(message);
}
