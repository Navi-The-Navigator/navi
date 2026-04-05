/**
 * Lightweight tool type used throughout Navi.
 *
 * Each tool receives a single raw-string input (the LLM may send JSON or
 * plain text) and returns a string result.  The shape is intentionally
 * compatible with `@github/copilot-sdk`'s `Tool` interface so that the
 * gateway can convert a `NaviTool` into an SDK tool with minimal glue.
 */
export type NaviTool = {
	name: string;
	description: string;
	func: (rawInput: string) => Promise<string>;
};
