/**
 * Reusable prompt building blocks.
 *
 * The current prompts in {@link ./main.ts} and {@link ./agents.ts} are kept
 * byte-identical to their previous inline form. These fragments are the seam a
 * later prose-unification pass will compose prompts from; they are exported so
 * that new or revised prompts can share the canonical wording instead of
 * re-deriving it. See {@link ./index.ts} `composeSections`.
 */

/** Markdown horizontal-rule separator used between prompt sections. */
export const SECTION_RULE = '\n\n---\n\n';

/** Canonical heading for the "progress updates" instruction block. */
export const PROGRESS_UPDATES_HEADING = '# 📡 Progress Updates';

/** Canonical heading for the "prohibited actions" block. */
export const PROHIBITED_HEADING = '# 🚫 Prohibited';

/** Join non-empty section bodies with the standard separator. */
export function composeSections(...sections: Array<string | undefined | null>): string {
	return sections.filter((section): section is string => Boolean(section)).join(SECTION_RULE);
}
