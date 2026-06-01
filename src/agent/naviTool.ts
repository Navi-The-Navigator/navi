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
	/**
	 * Optional JSON-schema for the tool's parameters. When omitted, the gateway
	 * exposes the default single `{ input: string }` schema. Additive: existing
	 * tools that take a raw string need not set this.
	 */
	inputSchema?: Record<string, unknown>;
	func: (rawInput: string) => Promise<string>;
};
