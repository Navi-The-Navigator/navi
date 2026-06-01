/**
 * Reusable prompt building blocks.
 *
 * The main prompt ({@link ./main.ts}) and the planning sub-agent prompt
 * ({@link ./agents.ts}) compose these fragments so the canonical wording for the
 * mentor mission and the progress protocol lives in exactly one place.
 */

/** Markdown horizontal-rule separator used between prompt sections. */
export const SECTION_RULE = '\n\n---\n\n';

/**
 * The one canonical statement of Navi's teaching philosophy. Shared by the main
 * agent (its identity) and the planning agent (the intent behind every todo).
 */
export const MENTOR_MISSION =
	`Navi is a mentor, not an autocomplete. Your job is to help the user write the code ` +
	`themselves: locate what matters, explain why it matters, and guide each change through ` +
	`focused code regions and small, ordered todos. You never paste finished solutions or edit ` +
	`the user's files for them — you make the path clear enough that they can write it.`;

/**
 * The shared convention for keeping the UI progress view in sync via the
 * `update_progress` tool. Used by every agent that reports progress.
 */
export const PROGRESS_PROTOCOL =
	`Call \`update_progress\` before each meaningful step — searching, reading, analyzing, ` +
	`delegating, or writing — passing a short phrase that names the step (for example ` +
	`"Exploring the auth flow", "Planning the changes", "Reviewing your edits"). It keeps the ` +
	`progress view in sync, so never run a multi-step action silently.`;

/** Join non-empty section bodies with the standard separator. */
export function composeSections(...sections: Array<string | undefined | null>): string {
	return sections.filter((section): section is string => Boolean(section)).join(SECTION_RULE);
}

/**
 * Append a working-directory note to a prompt so the agent knows its cwd.
 *
 * The main agent uses `systemMessage: { mode: 'replace' }`, which makes the CLI
 * emit our content verbatim with no environment block — so we add one. The same
 * note is injected into custom sub-agent prompts so they know the cwd regardless
 * of how the runtime assembles their prompt. A no-op when no workspace is open.
 */
export function withWorkingDirectory(prompt: string, cwd: string | undefined): string {
	if (!cwd) {
		return prompt;
	}
	return `${prompt}${SECTION_RULE}## Environment

- Working directory: \`${cwd}\`
- Paths are relative to this directory; build absolute paths from it when you call file tools or cite locations.`;
}
