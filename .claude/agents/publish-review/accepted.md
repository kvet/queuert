# Known Accepted Items

Reviewed and accepted as intentional design decisions. Do NOT report these — not as findings, not as "noted but accepted". If the code has changed so that an item no longer matches reality, report that once as a SUGGESTION to update this list.

Read by every `publish-review` agent and by `review-code`.

- **`helpersSymbol` exported publicly but marked `@internal`**: Required by `@queuert/dashboard` and `createWorkerRunner`. The `@internal` annotation is a convention, not enforcement.
- **`createAsyncRwLock` re-exported from `@queuert/sqlite` via the private `@queuert/helpers` package (inlined at build)**: SQLite users need this for transaction serialization.
- **Notify adapter channel prefix uses different separators**: Each adapter uses its transport's idiomatic separator (`:` for Redis, `_` for PG, `.` for NATS).
- **NATS notify adapter uses `subjectPrefix` while PG and Redis use `channelPrefix`**: Each adapter uses its transport's idiomatic terminology.
- **`testing` export declared in `publishConfig` but files excluded**: Testing utilities are workspace-only, not shipped to npm. The `publishConfig.exports` entry is overridden by the `files` exclusion.
- **NATS is experimental**: No provider abstraction, uses `nc` instead of `provider`, exports no types from `index.ts`. All will be standardized when the API stabilizes.
- **State adapter factory options for ID generation are aligned**: Both adapters use `generateJobId` (JS fn) and `validateJobId` (optional predicate). PG has no `idDefault` (SQL DEFAULT) in favor of JS-side generation for symmetry and to support caller-supplied IDs uniformly.
- **OTEL `workerError` does not record error details**: Counter attributes should remain low-cardinality per OTEL best practices. Error details are captured via the Log adapter.
- **`getStartAttemptDelayMs` uses `FOR UPDATE SKIP LOCKED`**: Accepted for now; future cleanup.
- **SQLite `createJobs` performs per-item deduplication lookups (O(n) round-trips for deduplicated items)**: Accepted SQLite trade-off; `addJobsBlockers` is batched via `json_each`.
- **A saturated fleet defers reclaiming an expired worker's jobs**: Reclaim runs only on an iteration with an idle slot, so while every slot is busy with a backlog, a crashed worker's running jobs wait. A fully busy fleet has no capacity to run them anyway; they are reclaimed once a slot frees up after the backlog.
- **PG batched `completeJobs` / `rescheduleJobs` / `continueJobs` don't lock rows in id order**: They can deadlock with `deleteChains` (which locks `ORDER BY id`) when both touch the same jobs; PostgreSQL aborts one side, which retries. A leading `FOR UPDATE ... ORDER BY id` CTE was measured: `completeJobs` p50 went from ~2ms to ~250ms in the query-performance benchmark, plus a lock pass on every write — too costly for a rare, self-recovering race.
- **Package READMEs are minimal**: Package READMEs link to the docs site; API documentation lives in TSDoc and the docs site. Do not ask for exports to be documented in READMEs.
