# Navi Agent Prompt Redesign — Design

**Date:** 2026-06-01
**Status:** Approved (pending spec review)
**Scope:** Redesign the system prompts and agent topology of Navi's AI stack.

---

## 1. Background & motivation

Navi is a mentor-style VS Code coding extension built on the GitHub Copilot SDK
(`@github/copilot-sdk`, which wraps the bundled Copilot CLI in
`node_modules/@github/copilot`). Its philosophy: **guide the user to write the
code themselves** via task decomposition (todos), highlighted *focus regions*,
and a traceable execution flow — not dump complete solutions.

Today the stack is one main agent plus **three** hand-written custom sub-agents:

- `code_exploration_agent` — search/locate code, return evidence.
- `planning_agent` — decompose a change into todos, write them via `manage_todos`.
- `code_review_agent` — judge completion and perform wrap-up (complete todo,
  clear focus regions).

Problems with the current prompts (`src/prompts/main.ts`, `src/prompts/agents.ts`):

1. **Tone/format** — heavy emoji headers (`## 🧭`, `🚫`) and ALL-CAPS
   `FORBIDDEN`/`MUST`; scannable but reads as AI-generated and is inconsistent
   between the main prompt and the sub-agents.
2. **Rigidity** — the main prompt mandates a full explore→plan→execute→review
   pipeline for *every* request, even a one-line conceptual question. Brittle.
3. **Capability/instruction mismatch** — `code_exploration_agent` is told to
   "search files / read code snippets" but its tool grant is only
   `get_errors` + `update_progress`. Per the SDK, a `tools` list *restricts* an
   agent to exactly those tools, so as written it likely cannot read or search.
   Same shape for `planning_agent` (only `manage_todos` + `update_progress`) even
   though it is asked to locate change points down to function/class/line.
4. **Mentor identity** — "guide, don't write the code" is stated once at the top
   and not woven into the behavior rules.

## 2. Key platform finding (decides the architecture)

The bundled Copilot CLI ships its own built-in sub-agents, addressable by name
through the `Task` tool's `agent_type` enum. Verified from the bundle
(`node_modules/@github/copilot/app.js`):

```js
rxr = ["explore","task","code-review","configure-copilot","critic"]
gin = [...rxr, "research"]
oxr = [...gin, "general-purpose"]   // built-in agent_type set
```

- Custom agents from the session config are **merged on top of** this built-in
  set (separate registry, concatenated) — they do not replace the built-ins.
- Navi's session sets **no** `availableTools`/`excludedTools` restriction, and
  `systemMessage: { mode: 'replace' }` swaps only the system *message*, not tool
  availability. So the `Task` tool and all built-in agents stay reachable.
- The built-in agent definitions live in
  `node_modules/@github/copilot/definitions/*.agent.yaml`. `explore` uses
  `grep/glob/view/bash/lsp` plus semantic-search and git-history tools.
  `code-review` and `critic` use `"*"` (all tools) and are instructed to never
  modify code.

**Hard constraint:** built-in agents have **no access to Navi's own tools**
(`manage_todos`, `clear_focus_code_region`, `update_progress`, focus tools).
Their toolsets are fixed in the CLI package. Therefore any responsibility that
mutates Navi state cannot be delegated to a built-in agent.

Residual risk: the enum's runtime contents in a headless SDK session that passes
`customAgents` are inferred from the bundle, not yet executed. Mitigation: a
short Extension-Dev-Host sanity check during implementation (see §9). Confidence
is high because the built-in list is a static array and custom agents are loaded
through a separate, additive registry.

## 3. Chosen architecture — hybrid

Net change: **3 custom agents → 2**. Review is delegated to built-in agents; the
main agent owns everything that mutates Navi state and applies wrap-up after a
built-in verdict.

> **Update (2026-06-01, post-review):** exploration was initially planned to use
> the built-in `explore` agent, but that agent's fixed toolset cannot call
> `update_progress`, so it cannot report milestone progress into its run panel.
> To get that progress, exploration is handled by a Navi-owned **`code_explorer`**
> custom agent that mirrors `explore`'s read-only toolset (`grep/glob/view/lsp/bash`)
> **plus** `update_progress`. Practical capability loss vs. built-in `explore` is
> ~nil for a local workspace (its extra semantic-search / github-mcp tools are
> generally not wired up locally).

| Responsibility | Handler | Mechanism |
| --- | --- | --- |
| Codebase investigation (locate / trace / understand) | Navi custom **`code_explorer`** | `Task(agent_type:"code_explorer")` |
| Decompose a change into todos | Navi custom **`planning_agent`** | `Task(agent_type:"planning_agent")` |
| "Does this satisfy the goal/acceptance?" critique (default reviewer) | built-in **`critic`** | `Task(agent_type:"critic")` |
| Bug/correctness check of substantial changes (escalation) | built-in **`code-review`** | `Task(agent_type:"code-review")` |
| Focus regions, todos, progress, **wrap-up** | **main agent** (Navi) | Navi's own tools |

### Decisions

- **`code_explorer` is a custom agent** (not the built-in `explore`) specifically
  so it can carry `update_progress` and surface milestone progress in its run
  panel — the run tracker already routes a sub-agent's `update_progress` calls to
  that run's panel.
- **Keep `planning_agent` as a custom sub-agent.** It is the irreducibly
  Navi-specific piece (writes todos), and keeping it a sub-agent preserves
  context isolation — planning deliberation renders in its own run panel rather
  than polluting the visible chat thread.
- **`critic` is the default reviewer; `code-review` is optional escalation.**
  Navi's review question is "did the user's edits satisfy *this todo's*
  acceptance criteria?" — a goal-oriented critique fed explicit context, which
  is `critic`'s purpose. `code-review` discovers scope via `git diff` and is
  tuned for bug-hunting, so it is the better *secondary* pass on larger/riskier
  changes.
- **Wrap-up stays in the main agent.** After a built-in verdict, the main agent
  marks the todo complete (`manage_todos`) and clears its focus regions
  (`clear_focus_code_region`) — only when the verdict supports completion.

## 4. Main agent prompt — `src/prompts/main.ts` (full rewrite)

Clean professional structure: consistent `##` headers, no decorative emoji, no
ALL-CAPS `FORBIDDEN` blocks (use clear "Do / Avoid" phrasing). Mentor identity
woven into the behavior rules rather than stated once. Sections:

1. **Identity & mission** — mentor coding companion in VS Code; guide the user to
   write the code themselves; never dump complete solutions. (sourced from the
   shared `MENTOR_MISSION` fragment.)
2. **How you work (adaptive, staged)** — triage every request:
   - Conceptual/trivial (no repo facts needed) → answer directly. No
     planning/focus/review ceremony.
   - "Where / why / how does X work" → delegate to `explore`, then synthesize a
     guided answer.
   - Code-change request → run the staged flow: *gather context (`explore` if
     needed) → `planning_agent` writes todos → execute todos one at a time
     (focus regions + guidance) → judgment (`critic`, escalate to `code-review`)
     → wrap-up.*
   - The stages are a **spine, not a mandate**: skip stages that do not fit.
3. **Delegation guide** — name each `agent_type`, when to use it, and that
   sub-agent prompts should carry full context (brevity rules do not apply to
   sub-agent prompts). State explicitly: do not search/read the repo yourself for
   non-trivial investigation — delegate to `explore` to keep the chat thread
   clean and let the run panel show the work.
4. **Focus region discipline** (preserved) — on entering a todo: collect all
   locations → create all focus regions at once via `focus_user_code_region`
   (do not ask first) → jump to the first → then explain.
5. **Todo rules** (preserved) — todos come only from `planning_agent`; execute in
   order; no inventing, reordering, or re-planning.
6. **Execution output format** (preserved) — for each guided step: current goal /
   where to change / what to do per focus region / acceptance criteria.
7. **Review & wrap-up** — delegate the check to `critic` (or `code-review` for
   substantial changes), then the main agent marks the todo complete and clears
   its focus regions — only when the verdict supports completion.
8. **Progress protocol** — call `update_progress` before investigation,
   delegation, and analysis; narrate one line of body text around each `Task`
   call; separate intermediate body-text outputs with a `***` divider. (sourced
   from the shared `PROGRESS_PROTOCOL` fragment.)

`buildFocusActionPrompt` (the review/help focus-action user-message builder) is
kept; wording lightly polished only, behavior unchanged.

## 5. `planning_agent` prompt — `src/prompts/agents.ts` (rewrite, same contract)

Clean structure, same job, tightened output schema:

- **Method**: collect *all* change points first (do not decompose while still
  searching), located down to function/class/logic block; then decompose into
  small todos — ≤ 3 change points, ≤ 2 files (prefer 1), completable in
  5–10 minutes; precise locations (no whole-file or single-line-only targets).
- **`tasks` vs `acceptance`**: tasks are executable coding steps; acceptance is
  outcome-oriented and implementation-independent; every task maps to an
  acceptance item and all acceptance is covered.
- **Write** the todos via `manage_todos` (list → compare to avoid duplicates →
  prefer full replace, else partial add). Visible todo text ≤ 30 chars, goal
  only, no implementation detail.
- **Output schema** (tightened, snake_case, stable shape): `todos[]` with
  `id`, `title`, `goal`, `locations[] { path, line_start, line_end,
  description, hint }`, `tasks[]`, `acceptance[]`.

## 6. Tool grants — `src/agent/agents/customAgents.ts`

Register `code_explorer` and `planning_agent`. Remove the old
`code_exploration_agent` and `code_review_agent` registrations (review is now
delegated to the built-in `critic` / `code-review`).

- `code_explorer` tools: `grep`, `glob`, `view`, `lsp`, `bash`, **`update_progress`**
  — the read-only investigation set plus the progress tool the built-in `explore`
  lacks. `infer: false`.
- `planning_agent` tools (fixes the current mismatch):
  `manage_todos`, `update_progress`, **`view`, `grep`, `glob`, `lsp`** — so it can
  actually locate change points. `infer: false` preserved.

Built-in tool name strings (`view`, `grep`, `glob`, `lsp`, `bash`) are not Navi
tools, so they are not added to `TOOL_NAMES` in `src/agent/tools/names.ts`. They
live in a separate `BUILTIN_TOOL_NAMES` const there. The built-in agent names the
main agent delegates to (`critic`, `code-review`) live in a `BUILTIN_AGENTS` const
in `customAgents.ts`.

## 7. Shared fragments — `src/prompts/fragments.ts`

Add two exported constants used by the main and planning prompts so the canonical
wording lives in one place:

- `MENTOR_MISSION` — the one statement of Navi's teaching philosophy.
- `PROGRESS_PROTOCOL` — the `update_progress` usage convention + the `***`
  divider rule.

Keep `SECTION_RULE` and `composeSections`. The existing `PROGRESS_UPDATES_HEADING`
/ `PROHIBITED_HEADING` constants are removed if unused after the rewrite.

## 8. Module API — `src/prompts/index.ts`

- `PromptId` narrows to `'planning'`.
- `AGENT_PROMPTS` keeps only `planning`; drop `codeExploration` / `codeReview`.
- Drop the `CODE_EXPLORATION_AGENT_SYSTEM_PROMPT` / `CODE_REVIEW_AGENT_SYSTEM_PROMPT`
  re-exports.
- Keep `loadPrompt('system')`, `agentPrompt('planning')`, and the `focusAction`
  path unchanged.

## 9. Tests

- `src/test/prompts.test.ts` — update the byte-identity hashes/lengths for
  `SYSTEM_PROMPT` and the planning prompt (the file's own comment says to update
  expected values in the same commit when a prompt legitimately changes); remove
  the `codeReview` / `codeExploration` assertions. Keep the focus-action
  byte-identity test (behavior unchanged).
- `src/test/customAgents.test.ts` — rewrite to assert exactly one custom agent
  (`planning_agent`) is registered, with `infer === false` and tools
  `['manage_todos','update_progress','view','grep','glob','lsp']` (order per
  implementation). Remove the exploration-agent assertions.
- **New guard test** — assert `SYSTEM_PROMPT` references the delegation contract
  by name: contains `code_explorer`, `critic`, `code-review`, and `planning_agent`.
- **Runtime sanity check (manual, non-CI)** — in the Extension Dev Host, confirm
  the main agent can actually invoke the custom `code_explorer` and the built-in
  `critic` from a Navi session, and that `code_explorer`'s `update_progress` calls
  surface in its run panel. Fallback if a built-in is unreachable: keep the custom
  agents and reconsider which review work moves into them.

## 10. Out of scope

- The sub-agent invocation mechanism, the `Task` tool, and the `infer` flag.
- UI rendering: built-in agent runs render via the generic
  `subagent.started/completed/failed` events (they carry `agentName` /
  `agentDisplayName`), and run *titles* resolve from the SDK-provided
  `agentDisplayName`. **Correction:** `src/chat/subagentRunTracker.ts` is *not*
  fully out of scope — it imports the removed name constants and tags the
  `code_review` run kind by agent name, so its imports and the
  kind/display/completion-text logic were updated to key on the built-in
  `critic` / `code-review` names. No other UI code changed.
- Any change to Navi's own tool implementations.
- Localization: prompts stay English (matches the "full English UI" direction).

## 11. Files touched (summary)

| File | Change |
| --- | --- |
| `src/prompts/main.ts` | Rewrite `SYSTEM_PROMPT`; light polish of `buildFocusActionPrompt`. |
| `src/prompts/agents.ts` | Rewrite `planning`; remove the two other prompts. |
| `src/prompts/fragments.ts` | Add `MENTOR_MISSION`, `PROGRESS_PROTOCOL`; prune unused. |
| `src/prompts/index.ts` | Narrow `PromptId`/`AGENT_PROMPTS`; drop two exports. |
| `src/agent/agents/customAgents.ts` | Register only `planning_agent`; fix tools; add `BUILTIN_TOOL_NAMES`. |
| `src/agent/tools/names.ts` | (Optional) host `BUILTIN_TOOL_NAMES`. |
| `src/test/prompts.test.ts` | Update hashes; drop removed-prompt cases; keep focus-action. |
| `src/test/customAgents.test.ts` | Assert single `planning_agent` + tools. |

## 12. Verification

- `npm run lint` and `npm test` pass.
- New guard test passes (delegation contract referenced by name).
- Manual Extension-Dev-Host sanity check (§9) before merge.
