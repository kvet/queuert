---
name: implement-task
description: Implement a task from TODO.md end-to-end — validate its design doc is current and implementable (bail with a gap report if not), then run an implementor/validator loop, then up to 3 rounds of review-code + review-docs. Use when picking up a TODO item for implementation.
---

# Implement a TODO Task

Take the `TODO.md` item **the user selected** and carry it to a finished, reviewed change — or stop early with a precise account of what the design doc does not answer. You never choose the task yourself.

You are the **implementor**. Every check on your work runs in a separate agent with a fresh context, because an agent that wrote the code is the worst judge of whether the code matches the design.

## Usage

```
/implement-task                          # implement the item highlighted in the editor
/implement-task chain identity           # select by fuzzy match on the item text
/implement-task design/job-priority.md   # select by design doc
```

## Bail-out rule (applies at every phase)

Stop as soon as the design doc cannot answer a question you must answer to write correct code — do not invent the answer, do not "pick the reasonable default and note it". Ambiguity that only affects naming or local structure is yours to decide; ambiguity that affects the persisted schema, the public API surface, migration behavior, or observable runtime semantics is the design's to decide.

When you bail:

1. Write `design/<doc-slug>.gaps.md` (or `design/<task-slug>.gaps.md` when the item has no design doc) using the Gap Report format below.
2. Leave the tree in a state the user can inspect — do not revert work already done, but do not leave a half-migrated schema or a failing build without saying so explicitly.
3. Report to the user: what was implemented, what stopped you, and the path to the gap report.

Do not continue to a later phase after a bail.

## Phase 1 — Resolve the selected task

The task is the user's choice, never yours. Resolve it in this order:

1. The skill argument, matched against `TODO.md` entry text or a `design/*.md` path.
2. The user's IDE selection in `TODO.md` (surfaced as `ide_selection` context) — if the selection covers a child bullet, that bullet is the task, not its epic.
3. Otherwise, ask with AskUserQuestion. Offer the candidates you can see; do not start on one because it looks ready.

Confirm the resolution back to the user in one line before doing any work, and stop if the match is ambiguous between two entries — pick nothing, ask instead.

Then read:

- The full `TODO.md` entry, including its parent `[EPIC]` bullet and sibling items — siblings often declare ordering (`Depends on ...`, `Prerequisite for ...`, `Requires ...`).
- Every `design/*.md` referenced by the entry, its epic, and its siblings.
- `CLAUDE.md` and `code-style.md`.

If the entry declares a dependency on another TODO item that is not yet implemented, stop and tell the user — an out-of-order implementation is a bail, not a judgment call.

## Phase 2 — Design viability gate

Launch **one** `general-purpose` agent with the instructions in `.claude/agents/implement-task/design-viability.md`. Give it the task text, the design doc paths, and the repo root.

Its verdict is one of:

- `VIABLE` — the design matches the current code and answers the decisions the implementation requires. Proceed.
- `STALE` — the design describes code that no longer exists or has since changed shape. Proceed **only** if the drift is cosmetic (renames the agent could map one-to-one); otherwise bail with a gap report listing each drifted claim.
- `INCOMPLETE` — one or more decisions the implementation requires are unanswered. Bail with a gap report.

Read the verdict critically. If the agent says `VIABLE` but its own evidence shows an unanswered schema/API/migration question, treat it as `INCOMPLETE`.

## Phase 3 — Implementor / validator loop

Repeat up to **3** iterations:

1. **Implement.** Write code and tests (per `CLAUDE.md`: all changes require tests). Follow the design doc's decisions literally — where you deviate, record why; an undocumented deviation is what the validator exists to catch. Run the targeted tests you touched (`bun vitest run packages/.../some.spec.ts`), not the full check suite.
2. **Validate.** Launch **one** `general-purpose` agent with `.claude/agents/implement-task/implementation-validator.md`. It gets the design doc paths, the task text, and the diff scope — never your reasoning about the code. It checks one thing the Phase 4 reviewers cannot, because they never read the design: whether the code matches the design and holds the invariants the design asserts. It returns findings graded `BLOCKER` / `CONCERN` / `NIT`, plus a `DESIGN_GAP` list.
3. **Decide.**
   - Any `DESIGN_GAP` → bail with a gap report (include what was already implemented).
   - Any `BLOCKER` → fix and re-validate.
   - Only `CONCERN`/`NIT` → address the reasonable ones, then exit the loop.

If 3 iterations end with blockers still open, stop and report the standing blockers rather than starting a fourth.

## Phase 4 — Review loop

Before the first round, run `bun run fmt`, then `bun run check > /tmp/implement-task-check.log 2>&1`. Verify it via the vitest `Test Files` / `Tests` summary lines, the typecheck exit-code lines, and the final exit code — never by grepping for "error"/"fail" (the examples emit those as legitimate output). Do not re-run `check` to re-filter its output; read the log file.

Then repeat up to **3** rounds:

1. Launch **two agents in parallel** (one message, two `Agent` calls):
   - `general-purpose` following `.claude/agents/review-code/instructions.md`, reviewing `git diff HEAD`.
   - `general-purpose` following `.claude/agents/review-docs/instructions.md`, over the same diff.
2. Address the **reasonable** findings yourself:
   - Fix every CRITICAL / MUST UPDATE, or explain in the final report why it does not apply.
   - Fix CONCERN / SHOULD REVIEW findings whose cost is proportionate to the change.
   - Skip SUGGESTION / NIT findings that expand scope beyond the task — say so, don't silently drop them.
   - A finding that exposes an unanswered design decision is a `DESIGN_GAP` → bail.
3. Re-run `bun run fmt` and `bun run check` after applying fixes.
4. Exit the loop early when a round produces no finding you chose to act on.

Reviewers are advisory, not authoritative. Push back in the report on findings that misread the design — and say which design decision they misread.

## Phase 5 — Finish

1. Write a `.changeset/<short-name>.md` entry if the change touches the public surface, runtime behavior, or persisted state (see `CLAUDE.md` for the bar and the one-paragraph cap). Internal refactors, tests, and doc-only edits are exempt.
2. Remove the completed item from `TODO.md`. If the item was one bullet of an `[EPIC]`, remove just that bullet; delete the epic only when its last child is gone. Delete any `[REF]` bullet the entry declares superseded by the completed work.
3. Confirm `bun run check` passed from the log, and say so plainly — or report the failures with their output.
4. Do not commit unless asked.

## Report format

```markdown
# Implemented: [task text]

**Design:** design/[doc].md · **Status:** complete | bailed | blocked

## What changed

[Files and the shape of the change, 3-6 bullets]

## Design decisions applied

[Each non-obvious decision, with the design doc line that dictated it]

## Deviations from the design

[Each deviation and why — or "none"]

## Review outcomes

[Findings acted on, and findings declined with the reason]

## Verification

[bun run check result: test-file/test counts, typecheck exit codes, final exit code]
```

## Gap report format

Written to `design/<slug>.gaps.md`:

```markdown
# Design gaps: [task text]

**Design doc:** design/[doc].md
**Stopped at:** design viability | implementation (iteration N) | review (round N)

## What the design does not answer

### 1. [The question, stated as a decision to be made]

- **Where it bites:** [the file/function that cannot be written without the answer]
- **What the doc says:** [quote, or "silent"]
- **Options, with consequences:** [each candidate answer and what it costs — persisted state, API surface, migration]
- **Blocked because:** [why a default cannot be picked here — schema/API/migration/semantics]

## What was implemented before stopping

[Files touched and their state — compiling, tested, partial]

## What to decide, in order

[The decisions in dependency order, so the design doc can be amended once]
```
