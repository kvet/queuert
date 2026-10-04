---
name: publish-review
description: Run a pre-publish review of the Queuert library — release hygiene (changesets, TODOs, package metadata), API surface, docs accuracy, plus schema and OTEL reviews when those areas changed since the last release, and benchmarks. Use when preparing to publish or validating publish readiness.
---

# Publish Readiness Review

Review the Queuert library before publishing. This complements the per-change reviews: `review-code` and `review-docs` check each diff (style, changeset per change, docs touched by the change, sibling-adapter consistency). This skill covers what per-diff reviews cannot see — drift accumulated across many changes, whole-library consistency, and release mechanics — so it does not re-check per-diff concerns like code style judgment.

## Usage

```
/publish-review          # scope to changes since the last release tag; schema/OTEL only if touched
/publish-review --full   # run every agent over the whole library regardless of what changed
```

## Step 1: Scope

```bash
BASE=$(git describe --tags --abbrev=0)
git diff --name-only $BASE..HEAD | wc -l
git diff --name-only $BASE..HEAD -- 'packages/*/src/state-adapter/**' 'packages-internal/typed-sql/**' | head -1
git diff --name-only $BASE..HEAD -- 'packages/otel/**' 'packages/core/src/observability-adapter/**' 'docs/src/content/docs/advanced/otel-*' | head -1
```

- **Schema agent** runs if state-adapter or typed-sql files changed (or `--full`).
- **OTEL agent** runs if OTEL/observability files changed (or `--full`).
- The other three agents always run.

## Step 2: Start benchmarks

Run `bun run benchmarks > <scratchpad>/benchmarks.log 2>&1` with `run_in_background: true`. You compare it against `docs/src/content/docs/benchmarks.md` yourself in Step 4 — no agent needed.

## Step 3: Launch agents

Launch all selected agents in ONE message (parallel `Agent` calls, `subagent_type: general-purpose`), using this prompt template:

```
You are the <role> for the Queuert library's pre-publish review.

Read, in order:
1. .claude/agents/publish-review/accepted.md — never report these items.
2. .claude/agents/publish-review/<file> — your checks and output format.

The last release tag is <BASE>. <"Focus on what changed since <BASE> (git diff --name-only <BASE>..HEAD), and on how those changes interact with code that did not change." | for --full: "Review the whole library.">

Report findings only — no inventories of things that are fine. Every finding needs a file:line and a concrete fix. Severity: CRITICAL = must fix before publish (docs lie about behavior, breaking change unflagged, data-integrity risk); WARNING = should fix; SUGGESTION = nice to have. Keep SUGGESTIONs to the 10 most valuable.
```

| Agent           | File                  | Role                               | Model                |
| --------------- | --------------------- | ---------------------------------- | -------------------- |
| Release hygiene | `release-hygiene.md`  | release hygiene auditor            | `sonnet`             |
| API surface     | `api-surface.md`      | API surface reviewer               | default              |
| Docs accuracy   | `docs-accuracy.md`    | documentation accuracy reviewer    | default              |
| Schema          | `schema-review.md`    | database schema reviewer           | default, conditional |
| OTEL            | `otel-conventions.md` | OTEL semantic conventions reviewer | default, conditional |

## Step 4: Consolidate

1. Drop anything matching `accepted.md` that slipped through, and merge duplicates reported by more than one agent.
2. Spot-check every CRITICAL by reading the cited lines. Downgrade or drop the ones that do not hold up, and say so.
3. Read the benchmarks log: report failures, and regressions against `docs/src/content/docs/benchmarks.md`.
4. Write `docs/publish-readiness-report.md`:

```markdown
# Queuert Publish Readiness Review

Generated: [date] · Scope: [BASE]..HEAD ([N] files) or full · Agents run: [list, and which were skipped as untouched]

## Summary

- Critical: [n] · Warnings: [n] · Suggestions: [n]

## Must Fix Before Publish

[CRITICAL items, each tagged with its area: hygiene / api / docs / schema / otel / benchmarks]

## Should Fix

[WARNING items, tagged]

## Consider for Future

[SUGGESTION items, tagged]

## Changesets

[The release-hygiene changeset table]

## Benchmarks

[Pass/fail and notable deltas]
```

5. Show the summary and the Must Fix list in the conversation.

When an accepted item is reported as no longer matching the code, propose the edit to `accepted.md` instead of silently keeping or dropping it.
