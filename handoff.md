# Handoff

State of the `next` branch as of 2026-11-13, for picking the work up later. Delete this file once its open items are done.

## Where things stand

`next` is rebased onto `dev` and force-pushed: one commit, `feat!: add the sync API and @queuert/ipc`, on top of the MySQL/MariaDB and Redis adapter commits. Besides the sync API it carries:

1. **Lint fixes** — zero oxlint warnings. Conformance cases call context members as `context.withX(…)` instead of destructuring them (`unbound-method`); `DuplicateError` in `modal.spec.ts` sets its `name`.
2. **Public in-process adapters and their benchmarks**
   - `queuert` exports `createInProcessStateAdapter`, `createSyncInProcessStateAdapter`, `InProcessStateAdapter`, `SyncInProcessStateAdapter`, `createInProcessNotifyAdapter` and `createSyncInProcessNotifyAdapter`. `InProcessContext` and the options type stay internal; no notify adapter exports its own type. `queuert/internal` no longer exports them.
   - `.changeset/in-process-adapters.md` replaces `hide-in-process-state.md`; the "Removed: `createInProcessNotifyAdapter`" bullet is gone from `in-process-notify-default.md`.
   - Docs: the in-process state adapter page, card, sidebar entry and home-page link are back; the notify adapters page mentions sharing one in-process adapter between clients; code-style's "In-Process Adapters" section is rewritten.
   - `seedAllStates` and the index coverage cases run over adapters of either mode through `inTransaction`.
   - New benchmarks: `benchmarks/query-performance/src/in-process.ts` and `benchmarks/runtime-performance/src/state-in-process-sync.ts`, both on the synchronous in-process adapter (the async in-process scenarios were dropped from every suite). Their numbers are in `docs/src/data/benchmarks.ts`.
3. **Plan** — `design/conformance-generator-style.md`, its TODO entry, and this file.

Verified: `pnpm lint` (0 warnings), `pnpm typecheck`, `pnpm test` (204 files, 21,829 tests) and `pnpm examples`.

## Uncommitted on top

- **Conformance in generator style** (`design/conformance-generator-style.md`, all five phases): every conformance case is a `caseBody` generator (`@queuert/helpers/case-body`: `caseBody`, `wait`, `resource`), each case takes its mode from the first adapter it creates, `rejectionOf` and `assertUnsubscribeResult` are gone, and `.changeset/conformance-mode-checks.md` covers it.

## Known caveats

- **Benchmark data mixes runs.** After the rebase, rows both sides had keep the sync-work numbers, rows only `dev` had (MySQL, MariaDB, Redis, async In-process on processing capacity) keep `dev`'s, and the in-process rows added since are fresh. The processing-capacity "State adapter" In-process rows are fresh from the in-process state adapter rewrite; the runtime-performance and query-performance in-process rows are fresh too, while the "Notify adapter (in-process state)" rows still measure the previous adapter. The runtime profile phase now runs with `--enable-source-maps`, so the other runtime rows will shift slightly on their next run (helpers bundled into an adapter package count as core). Re-run all three suites before a release.
- **`benchmarks/query-performance/src/sqlite.ts` does not compile** (its hand-written async provider lacks `onTransactionCommit`, `onTransactionRollback` and `classifyError`, and its context lacks `txHooks`). It was already broken at the sync-work commit; the package has no `typecheck` script, so `pnpm check` misses it.
- The rebase dropped the old local `next` WIP commit `b94ec517` (and the memory note that pointed to `no-unasync-progress.md`, which no longer exists); it is only in the reflog.
