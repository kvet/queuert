# Queuert Code Style Guide

## Session Requirements

- **Consult [reference docs](docs/src/content/docs/advanced/) before changes**: When modifying adapters, job processing, workers, or other core systems, read the corresponding reference doc first to understand architectural decisions that must be preserved
- **Changes require tests**: All code changes must include corresponding tests
- **Meaningful changes require a short changeset**: Any change that alters the public surface, runtime behavior, or persisted state — API renames or signature changes, observable behavior changes, schema/migration changes (they execute on the user's DB), user-visible bug fixes, breaking changes (always `major`) — needs a `.changeset/<short-name>.md` entry. Bump every affected package (`patch` / `minor` / `major`) and write a one-paragraph description framed for a user reading release notes; cap the entry at one paragraph + a flat bullet list of what changed (no nested headings, comparison tables, code blocks, or multi-step migration walkthroughs — those belong in the GitHub release notes or a docs migration page). Skip changesets for internal refactors with no API impact, tests, types-only tightening, doc-only edits, build/CI/tooling, benchmarks, examples, and comment tweaks. Fold related multi-package or multi-step work into a single changeset rather than creating one per commit. When in doubt, write the changeset — a small note is cheap; a missed release note is not.
- No obvious comments
- Run `bun run fmt` before running checks to fix formatting issues
- Run individual tests during development (e.g., `bun vitest run packages/core/src/specs/some.spec.ts`)
- Run `bun run check` once the change is finalized to verify everything passes (`bun run lint`, `bun run typecheck`, `bun run test`, `bun run examples`)
- **Never re-run `bun run check` (or any other multi-minute task) just to filter its output differently.** If you need to inspect the output multiple ways, redirect it to a file once (`bun run check > /tmp/check.log 2>&1`) and grep/read the file. Re-invoking the command wastes minutes per iteration.
- **Don't grep check output for words like "error", "fail", "FAIL".** The examples emit those as legitimate content (showcase logs, simulated errors, retry demos) and produce false positives. To verify a check, rely on vitest's `Test Files`/`Tests ` summary lines, the typecheck `Exited with code N` lines, and the command's final exit code — not free-text matches.
- See [Code Style](code-style.md) for testing patterns, documentation update guidelines, and examples naming conventions
- When creating or modifying examples, follow the naming convention and single-purpose design described in Code Style
- Remove todo items as soon as their work is done, whether completed directly or via sub-agents
