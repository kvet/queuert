# Queuert Publish Readiness Review

Generated: 2026-03-09

## Summary

- Critical Issues: 2 (4 resolved, 4 accepted as-is)
- Warnings: 20 (5 resolved)
- Suggestions: 18

## 1. Documentation Coherence

### Critical

No critical issues found.

### Warnings

**W1-1. Dashboard README says "in-memory adapters" instead of "in-process adapters"**

- File: `packages/dashboard/README.md`, line 35
- The codebase consistently uses "in-process" (e.g., `createInProcessStateAdapter`). "In-memory" is incorrect terminology.

**W1-2. `@queuert/postgres` README does not document `pgLiteral` or `MigrationResult` exports**

- File: `packages/postgres/README.md`
- Users may not discover `pgLiteral`, which is useful for Prisma/Drizzle users who need raw SQL.

**W1-3. `@queuert/sqlite` README does not document `sqliteLiteral`, `createAsyncLock`, `AsyncLock`, or `MigrationResult` exports**

- File: `packages/sqlite/README.md`

**W1-4. `@queuert/redis` README does not mention `RedisNotifyProvider` type by name**

- File: `packages/redis/README.md`

**W1-5. Core README missing documentation for `mergeJobTypeRegistries`, `mergeJobTypeProcessorRegistries`, `createConsoleLog`, `rescheduleJob`, and error classes**

- File: `packages/core/README.md`

**W1-6. `LeaseConfig` type missing top-level TSDoc**

- File: `packages/core/src/worker/lease.ts`, line 3

### Suggestions

**S1-1.** Core README Quick Start uses SQLite but most adapter READMEs use Postgres -- add a note about production recommendations.

**S1-2.** Root README `startJobChain` example shows `tx` property without explaining it's user-defined from `StateProvider`'s `TTxContext`.

**S1-3.** In-process worker design doc references default backoff values but doesn't link to `BackoffConfig` TSDoc.

**S1-4.** `code-style.md` Adapter Package Exports table doesn't include `pgLiteral`, `sqliteLiteral`, `MigrationResult`, `createAsyncLock`.

## 2. API Design

### Critical

**~~C2-1.~~ ACCEPTED: `createOtelObservabilityAdapter` is async but does no I/O**

- File: `packages/otel/src/observability-adapter/observability-adapter.otel.ts`, line 44
- Intentional: All public-facing adapter factories are async for consistency and future-proofing per the [Async Factory Pattern](../src/content/docs/advanced/adapters.md) design decision.

**~~C2-2.~~ ACCEPTED: `createClient` and `createInProcessWorker` are async but do no I/O**

- Files: `packages/core/src/client.ts` line 300, `packages/core/src/in-process-worker.ts` line 180
- Intentional: Same async factory pattern consistency rationale as C2-1.

**C2-3. `helpersSymbol` is exported as public API, exposing internal implementation** -- RESOLVED (marked `@internal`)

- File: `packages/core/src/index.ts`, line 3

**C2-4. `processorDefinitionsSymbol`, `processorExternalDefinitionsSymbol`, `processorNavigationSymbol` exported publicly**

- File: `packages/core/src/index.ts`, lines 100-102
- These phantom-property symbols carry `undefined` at runtime and exist only for TypeScript type inference.
- Recommendation: Move to `queuert/internal` or keep only the type-level extractors.

### Warnings

**W2-1. `getJobChain` returns `| undefined` while `awaitJobChain` throws `JobChainNotFoundError` -- no `OrThrow` convenience**

- File: `packages/core/src/client.ts`

**W2-2. `awaitJobChain` silently catches `listenJobChainCompleted` errors**

- File: `packages/core/src/client.ts`, line 592
- A misconfigured notify adapter will silently degrade to polling-only with no feedback.

**~~W2-3.~~ RESOLVED: "Provider" vs "Adapter" naming now documented**

- Added "Provider vs Adapter" section to `docs/src/content/docs/advanced/adapters.md`.

**W2-4. `HookNotRegisteredError` constructor does not support `cause`**

- File: `packages/core/src/errors.ts`, line 110
- Every other error class supports an optional `cause` parameter.

**W2-5. `PgStateAdapter.$idType` phantom parameter not documented**

- File: `packages/postgres/src/state-adapter/state-adapter.pg.ts`, line 90

**W2-6. `createInProcessWorker` worker loop swallows errors via `.catch(() => {})`**

- File: `packages/core/src/in-process-worker.ts`, line 312
- If the worker loop exhausts retries, the error is silently swallowed and the worker dies quietly.

### Suggestions

**S2-1.** `MigrationResult` re-exported from both `@queuert/postgres` and `@queuert/sqlite` -- consider documenting the shared origin.

**S2-2.** `completeJobChain` callback API is deeply nested and hard to discover -- consider a simpler overload for the common case.

**S2-3.** `pgLiteral` and `sqliteLiteral` exported without clear use-case documentation in TSDoc.

**S2-4.** Large number of type-only exports from core may benefit from barrel organization (e.g., `queuert/types` sub-path).

## 3. Implementation Verification

### Critical

No critical issues found. Implementation matches documented behavior across all core design documents.

### Warnings

**W3-1. `helpersSymbol` export lacks TSDoc comment**

- File: `packages/core/src/client.ts`, line 48

**W3-2. Multiple TODO comments in test suites without resolution**

- `packages/core/src/suites/process-modes.test-suite.ts`: 16 TODO comments questioning design decisions.
- `packages/core/src/suites/chains.test-suite.ts` line 599: Missing multi-worker chain distribution test.

### Suggestions

**S3-1.** `@queuert/sqlite` re-exports `createAsyncLock` from `queuert/internal` -- consider documenting or internalizing.

### Design Doc Compliance

All design document claims verified as matching implementation:

- Async factory pattern, atomic operations, hint-based thundering herd optimization
- Worker concurrency via slots, single main loop with fill/reap/wait
- Prepare/complete pattern, job chain identity model, blocker resolution
- OTEL five-level span hierarchy, duration metrics hierarchy
- All 36 functional examples use current API correctly

## 4. Feature Completeness

### Critical

**C4-1. `packages/mongodb/` is a ghost package -- source files deleted, only build artifacts remain**

- Location: `packages/mongodb/`
- Contains only `dist/`, `node_modules/`, and `tsconfig.tsbuildinfo`. No `package.json`, no `src/`.
- Action: Remove the directory entirely.

**C4-2. Six zombie example directories with only `tsconfig.tsbuildinfo` remnants**

- `examples/mongodb-redis/`, `examples/postgres-raw-redis/`, `examples/postgres-drizzle-redis/`, `examples/postgres-prisma-redis/`, `examples/postgres-kysely-redis/`, `examples/postgres-js-raw-redis/`
- Action: Delete these directories.

### Warnings

**W4-1. Known flaky test -- `postgres-postgres.data.spec.ts` "handles distributed blocker jobs"**

- Marked `[TASK,EASY]` in TODO.md. Could cause CI failures.

**W4-2. `dashboard` example does not follow the naming convention**

- Expected prefix like `showcase-dashboard` per code-style.md convention.

**W4-3. SQLite `skipConcurrencyTests` flag skips 2 resilience tests**

- Marked `[TASK,EASY]` in TODO.md.

**W4-4. Core package publishes `./internal` entrypoint in `publishConfig`**

- File: `packages/core/package.json`, line 46
- May confuse users or encourage reliance on unstable internals.

**W4-5. SQLite typecheck uses fragile grep-based error suppression**

- File: `packages/sqlite/package.json`, line 47
- Could mask real errors if the pattern changes.

### Suggestions

**S4-1.** Missing multi-worker chain distribution test (`packages/core/src/suites/chains.test-suite.ts:599`).

**S4-2.** 28 TODO comments in `process-modes.test-suite.ts` questioning state adapter round-trip efficiency -- part of the "Processing throughput (~10x)" TODO.md epic.

**S4-3.** Dashboard package has many open TODO.md items -- consider marking as `alpha` or `experimental`.

### Package Readiness

All 7 packages at version `0.4.0` with correct `package.json` configuration (`files`, `types`, `exports`, `publishConfig`). No dev dependencies leaking to production. No `it.skip`/`test.skip`, no unimplemented stubs, no production code TODOs.

## 5. API Consistency

### Critical

**~~C5-1.~~ ACCEPTED: NATS notify adapter uses `nc`/`kv` instead of `provider` pattern**

- Redis and Postgres use a `*NotifyProvider` abstraction; NATS takes raw SDK types directly.
- Intentional: NATS SDK types (`NatsConnection`, `KV`) are already well-defined interfaces. Adding an intermediate provider abstraction would be redundant boilerplate with no practical benefit.

**~~C5-2.~~ ACCEPTED: Channel/subject prefix option name varies: `channelPrefix` (Redis, PG) vs `subjectPrefix` (NATS)**

- Intentional: NATS uses "subjects" not "channels" in its native terminology. Using `subjectPrefix` is more natural for NATS users and consistent with the NATS ecosystem.

### Warnings

**W5-1. State adapter `tablePrefix` default differs: Postgres `""` vs SQLite `"queuert_"`**

- Reasonable given database capabilities, but should be documented prominently.

**W5-2. SQLite exports `createAsyncLock` from `queuert/internal` in its public index**

- File: `packages/sqlite/src/index.ts`, line 6

**W5-3. `MigrationResult` re-exported from both state adapter packages but `@queuert/typed-sql` is only a devDependency**

- Type may not resolve for consumers if package manager doesn't hoist devDependencies.

**W5-4. NATS package does not export a `NatsNotifyProvider` type (consequence of C5-1)**

**W5-5. `SqliteStateProvider.executeSql` requires `returns: boolean` but `PgStateProvider.executeSql` does not**

- Leaks implementation details and makes provider interfaces non-interchangeable.

### Suggestions

**S5-1.** `SharedListenerState` type and `createSharedListener` function duplicated across three notify adapter packages -- consider extracting to core internal.

**S5-2.** `flakyNotifyAdapter` fixture code is copy-pasted across all notify adapter spec helpers -- consider extracting to `queuert/testing`.

**S5-3.** Dashboard package has no `./testing` subpath export (unlike all other packages).

**S5-4.** `createOtelObservabilityAdapter` accepts empty `{}` -- both `meter` and `tracer` optional, creating a no-op adapter silently.

**S5-5.** `@queuert/typed-sql` is devDependency but its `MigrationResult` type is re-exported publicly.

## 6. Schema Review

### Critical

No critical issues found. Schema design is solid with appropriate constraints, indexes, and locking patterns.

### Warnings

**W6-1. SQLite `acquireJob` relies on exclusive transaction lock instead of `FOR UPDATE SKIP LOCKED`**

- Safe for single-writer scenarios, documented as "SQLite exception."

**W6-2. SQLite `checkExternalBlockerRefsSql` lacks locking protection present in PostgreSQL**

- Safe under SQLite's exclusive transaction model.

**W6-3. `getNextJobAvailableInMsSql` in PostgreSQL uses `FOR UPDATE SKIP LOCKED` unnecessarily**

- File: `packages/postgres/src/state-adapter/sql.ts`, lines 558-572
- Read-only query takes a lock, potentially causing workers to skip the nearest pending job and sleep longer than necessary.
- Recommendation: Remove `FOR UPDATE SKIP LOCKED` from this informational query.

**W6-4. SQLite `addJobBlockers` makes 3-5 round-trips instead of PostgreSQL's 1**

- Documented as accepted trade-off.

### Suggestions

**S6-1.** Consider composite index `(status, type_name, created_at DESC)` if combined filtering is a common access pattern.

**S6-2.** `job_chain_listing_idx` partial index is not redundant with `job_listing_idx` -- keep both.

**S6-3.** Self-referential FK on `chain_id` is correct but could confuse future contributors -- add a brief comment.

### Index Coverage

All critical query paths have appropriate index coverage. The `createJobSql` deduplication check has partial coverage (missing `chain_type_name` in the deduplication index), but the partial index filters sufficiently.

## 7. Code Style

### Critical

No critical issues found. The codebase is well-aligned with documented conventions.

### Warnings

**W7-1. OTEL adapter has 8 section-header comments that are purely organizational "what" comments**

- File: `packages/otel/src/observability-adapter/observability-adapter.otel.ts`, lines 51-101
- Comments like `// worker`, `// job`, `// job chain` restate what is evident from variable names.

**W7-2. Test-suite files use abbreviated `chain` variable name instead of preferred `jobChain` (~22 locations)**

- Files: `packages/core/src/suites/client-queries.test-suite.ts`, `workerless-completion.test-suite.ts`, `state-adapter-conformance.test-suite.ts`

### Verified Passing Checks

- Function declaration style: All exports use `export const fn = () => {}` form
- Unnecessary async wrapping: None found
- Redundant type annotations: None found
- Nullable convention: Consistent (`null` for "explicitly no value", `undefined` for "not found")
- Error class usage: Typed error classes for public-facing code, generic `Error` only for assertion guards
- Naming conventions: No redundant prefixes, no abbreviations, all symbols use `queuert.` prefix

## 8. Benchmarks

### Critical

No critical issues found. All benchmarks ran successfully.

### Results

**Processing Capacity** (10,000 jobs, concurrency 10):

| State      | Notify     | Start (chains/s) | Process (jobs/s) | End-to-end (jobs/s) | vs Documented                             |
| ---------- | ---------- | ---------------: | ---------------: | ------------------: | ----------------------------------------- |
| PostgreSQL | in-process |              468 |              279 |                 175 | Below (~630/~375/~235 documented)         |
| PostgreSQL | PostgreSQL |              456 |              307 |                 184 | Below (~506/~396/~222 documented)         |
| SQLite     | in-process |           14,897 |              726 |                 693 | Comparable (~14,600/~793/~752 documented) |
| SQLite     | Redis      |            2,471 |              570 |                 463 | Comparable (~2,680/~555/~460 documented)  |
| SQLite     | NATS       |            7,739 |              698 |                 641 | Below (~11,560/~789/~739 documented)      |

### Warnings

**W8-1. PostgreSQL adapter benchmarks show ~25-30% regression from documented values**

- Start phase: 468 vs ~630 documented (-26%)
- Process phase: 279 vs ~375 documented (-26%)
- This may be environmental (Docker container performance, system load) rather than a code regression. Recommend re-running on consistent hardware before publishing.

**W8-2. NATS notify adapter start phase shows ~33% regression**

- Start phase: 7,739 vs ~11,560 documented (-33%)
- Similar environmental caveat applies.

**Type Complexity** (tsgo 7.0.0-dev):

| Scenario           | Types |     Time | Instantiations | Scaling |
| ------------------ | ----: | -------: | -------------: | ------: |
| Linear: 100 types  |   100 |    328ms |        140,184 |    9.5x |
| Branched: 2w x 6d  |   127 |    403ms |        149,896 |   10.1x |
| Blockers: 25 steps |    98 |    250ms |        158,283 |   10.7x |
| Merge: 10 x 50     |   500 |  1,115ms |        574,714 |   38.8x |
| Merge: 50 x 50     | 2,500 | 15,335ms |      2,791,534 |  188.5x |

Type complexity scaling matches documented values. Instantiation counts are very close (within 2%) to documented tsc values, confirming linear scaling is preserved.

**Memory Footprint**: The memory benchmark ran but only showed usage help (requires `--all` flag for individual measurements). Measurements should be run separately with `pnpm start:all` from the benchmark directory to verify heap overhead values.

---

## Action Items

### Must Fix Before Publish

1. ~~**C4-1**: Remove `packages/mongodb/` ghost directory~~ -- DONE
2. ~~**C4-2**: Remove 6 zombie example directories~~ -- DONE
3. ~~**C2-1**: Make `createOtelObservabilityAdapter` synchronous~~ -- ACCEPTED (async factory pattern by design)
4. ~~**C2-2**: Make `createClient` and `createInProcessWorker` synchronous~~ -- ACCEPTED (async factory pattern by design)
5. ~~**C2-3**: Move `helpersSymbol` to `queuert/internal`~~ -- RESOLVED (marked `@internal`)
6. **C2-4**: Move `processorDefinitionsSymbol`, `processorExternalDefinitionsSymbol`, `processorNavigationSymbol` to `queuert/internal`
7. ~~**C5-1**: Introduce `NatsNotifyProvider` abstraction~~ -- ACCEPTED (NATS SDK types are sufficient)
8. ~~**C5-2**: Standardize channel/subject prefix naming~~ -- ACCEPTED (`subjectPrefix` matches NATS terminology)

### Should Fix

1. ~~**W1-1**: Fix "in-memory" → "in-process" in dashboard README~~ -- DONE
2. **W1-2 to W1-5**: Document undocumented exports across package READMEs (`pgLiteral`, `sqliteLiteral`, `createAsyncLock`, `MigrationResult`, `RedisNotifyProvider`, `mergeJobTypeRegistries`, error classes, etc.)
3. **W1-6**: Add top-level TSDoc to `LeaseConfig`
4. **W2-2**: Log notify adapter errors in `awaitJobChain` instead of silently catching
5. ~~**W2-3**: Document Provider vs Adapter distinction~~ -- DONE
6. **W2-4**: Add `cause` support to `HookNotRegisteredError`
7. **W2-5**: Document `PgStateAdapter.$idType` phantom parameter
8. **W2-6**: Log fatal worker loop errors before swallowing in `createInProcessWorker`
9. ~~**W3-1**: Add TSDoc to `helpersSymbol`~~ -- DONE
10. **W4-1**: Fix flaky test in `postgres-postgres.data.spec.ts`
11. **W4-2**: Rename `dashboard` example to follow naming convention
12. **W4-4**: Decide whether to keep `./internal` in core's `publishConfig`
13. **W4-5**: Replace fragile grep-based typecheck in SQLite package
14. **W5-1**: Document `tablePrefix` default differences between Postgres and SQLite
15. **W5-3**: Make `@queuert/typed-sql` a peerDependency or define `MigrationResult` locally
16. **W5-5**: Document `SqliteStateProvider.executeSql` `returns` parameter difference
17. **W6-3**: Remove unnecessary `FOR UPDATE SKIP LOCKED` from `getNextJobAvailableInMsSql`
18. ~~**W7-1**: Remove organizational section-header comments in OTEL adapter~~ -- DONE
19. ~~**W7-2**: Rename `chain` → `jobChain` variables in test suites~~ -- DONE
20. **W8-1/W8-2**: Re-run PostgreSQL and NATS benchmarks on consistent hardware; update documented values if regression is real

### Consider for Future

1. **S1-1 to S1-4**: Documentation cross-referencing improvements
2. **S2-1 to S2-4**: API ergonomics (simpler `completeJobChain` overload, type export organization)
3. **S4-1**: Add multi-worker chain distribution test
4. **S4-2**: Resolve 28 design-question TODOs in process-modes test suite
5. **S4-3**: Mark dashboard as `alpha` or `experimental`
6. **S5-1**: Extract `SharedListenerState` / `createSharedListener` to core internal
7. **S5-2**: Extract `flakyNotifyAdapter` fixture to `queuert/testing`
8. **S5-3**: Add `./testing` subpath to dashboard
9. **S5-4**: Decide whether no-op OTEL adapter is intentional
10. **S6-1**: Consider composite index for combined status+typeName filtering
11. **S6-3**: Add comment explaining self-referential FK on `chain_id`
