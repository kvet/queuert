# Known Accepted Items

Reviewed and accepted as intentional design decisions. Do NOT report these — not as findings, not as "noted but accepted". If the code has changed so that an item no longer matches reality, report that once as a SUGGESTION to update this list.

Read by every `publish-review` agent and by `review-code`.

- **`createOtelObservabilityAdapter` is async**: Reserves the right to add async initialization later.
- **`createClient` is async but performs no I/O**: Reserves the right to add async initialization later.
- **`createInProcessWorker` is async but performs no I/O**: Reserves the right to add async initialization later.
- **`helpersSymbol` exported publicly but marked `@internal`**: Required by `@queuert/dashboard` and `createInProcessWorker`. The `@internal` annotation is a convention, not enforcement.
- **`createAsyncRwLock` re-exported from `@queuert/sqlite` via `queuert/internal`**: SQLite users need this for transaction serialization.
- **`HookNotRegisteredError` does not accept `cause`**: This error is never caused by another error.
- **Notify adapter channel prefix uses different separators**: Each adapter uses its transport's idiomatic separator (`:` for Redis, `_` for PG, `.` for NATS).
- **NATS notify adapter uses `subjectPrefix` while PG and Redis use `channelPrefix`**: Each adapter uses its transport's idiomatic terminology.
- **`testing` export declared in `publishConfig` but files excluded**: Testing utilities are workspace-only, not shipped to npm. The `publishConfig.exports` entry is overridden by the `files` exclusion.
- **NATS is experimental**: No provider abstraction, uses `nc`/`kv` instead of `provider`, exports no types from `index.ts`. All will be standardized when the API stabilizes.
- **State adapter factory options for ID generation are aligned**: Both adapters use `generateId` (JS fn) and `validateId` (optional predicate). PG has no `idDefault` (SQL DEFAULT) in favor of JS-side generation for symmetry and to support caller-supplied IDs uniformly.
- **OTEL `workerError` does not record error details**: Counter attributes should remain low-cardinality per OTEL best practices. Error details are captured via the Log adapter.
- **`getStartAttemptDelayMs` uses `FOR UPDATE SKIP LOCKED`**: Accepted for now; future cleanup.
- **SQLite `createJobs` performs per-item deduplication lookups (O(n) round-trips for deduplicated items)**: Accepted SQLite trade-off; `addJobsBlockers` is batched via `json_each`.
- **Package READMEs are minimal**: Package READMEs link to the docs site; API documentation lives in TSDoc and the docs site. Do not ask for exports to be documented in READMEs.
