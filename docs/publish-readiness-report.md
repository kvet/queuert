# Queuert Publish Readiness Review

Generated: 2026-11-15 · Scope: v0.17.0..HEAD (1300 files) · Release: 0.18.0 · Agents run: release hygiene, API surface, docs accuracy, comparison, schema, OTEL (none skipped — state-adapter/typed-sql and OTEL files both changed)

## Summary

- Critical: 1 · Warnings: 24 · Suggestions: 33

## Must Fix Before Publish

1. **[docs]** Three state-adapter pages say `migrateToLatest()` checks the server version; 480d7f11 removed every server check (no version query remains in `packages/{postgres,sqlite,redis}/src`). Spot-checked.
   - `docs/src/content/docs/integrations/state-adapters/postgres.tsx:97` → "Requires PostgreSQL 14 or later."
   - `docs/src/content/docs/integrations/state-adapters/sqlite.tsx:95-96` → "Requires SQLite 3.42 or later, in the version your driver bundles."
   - `docs/src/content/docs/integrations/state-adapters/redis.tsx:293-294` → drop "`migrateToLatest()` checks the version."

## Should Fix

### Release

1. **[hygiene]** `@queuert/ipc` and `@queuert/mysql` publish for the first time; `.github/workflows/publish.yaml:34` uses OIDC trusted publishing, which cannot create a new package. Create both on npm with the trusted publisher configured (or do a one-off token publish) before tagging.

### Schema

2. **[schema]** The 0.17 upgrade deletes the `002_worker_liveness` record (`packages/postgres/src/state-adapter/legacy-upgrade.pg.ts:55`, `packages/sqlite/src/state-adapter/legacy-upgrade.sqlite.ts:55`). Any 0.17 process that boots afterwards re-runs 002 and fails on `CREATE TABLE {prefix}worker`; rollback to 0.17 needs a manual re-insert. Running 0.17 workers are fine, as the docs say. Fix: keep the record and detect the legacy state by the missing fence table — the new migrator already tolerates unknown names (`packages-internal/typed-sql/src/migrator.ts:97,229`). Spot-checked.
3. **[schema]** Deletes are unfenced (`state-adapter.pg.ts:1143-1170`, `state-adapter.sqlite.ts:1355,1373`, `state-adapter.mysql.ts:1180,1187`, Redis delete script). Once 0.18 ships, a fenced-out 0.18 process can still delete `job`/`job_blocker` rows under a future schema — the planned `chain` table (`design/chain-table.md`) would be orphaned. Fence the delete CTEs/statements now, or commit in the design doc that future schemas stay delete-compatible with 0.18.
4. **[schema]** Deduplication is best-effort under concurrency on PostgreSQL and MySQL (`state-adapter.pg.ts:788-800`, `state-adapter.mysql.ts:812-836`), but `docs/src/content/docs/guides/deduplication.mdx:10` says it "prevents duplicate chains". Add a caveat; keep the real fix on the chain-identity track.

### API

5. **[api]** `packages/mysql/src/index.ts:13-18` doesn't re-export `RuntimeType`, which `MysqlStateProvider.executeSql` uses (`state-provider.mysql.ts:65-66`). Postgres and SQLite export it.
6. **[api]** `PgStateProviderError` / `SqliteStateProviderError` / `MysqlStateProviderError` are plain objects (`{ kind: "undefined_table"; tableName }`), not Error classes, unlike every other public `…Error`. All are new in 0.18 — rename now (e.g. `PgClassifiedError`) while it's free.
7. **[api]** `packages/redis/src/conformance/state-provider-conformance.ts:35-60` exports `redisStateAdapterLockWaitCaseNames` and filters core cases by title string. Renaming a core case becomes a Redis breaking change, contradicts code-style's group-set rule, and 7 of 12 titles filter nothing. Move lock-wait cases into core group sets and drop the export.

### Docs

8. **[docs]** "Testing your provider" sections omit the new `stateAdapterOptions` (`postgres.tsx:217-230`, `sqlite.tsx:262-285`, `mysql.tsx:212-220`, `redis.tsx:500-506`).
9. **[docs]** `docs/src/content/docs/integrations/notify-adapters/nats.tsx:17-18` says "Like Redis, NATS … does not store job state" — Redis now has a state adapter. Drop "Like Redis,".
10. **[docs]** `docs/src/content/docs/guides/job-blockers.mdx:111` limits `maxBlockersPerJob` to PG/SQLite factories; MySQL, Redis and in-process take it too.
11. **[docs]** `docs/src/content/docs/guides/tx-hooks.mdx:30-33` example provider opens `sql.begin(...)` without READ COMMITTED, which `PgStateProvider.withTransaction` now requires.
12. **[docs]** `docs/src/content/docs/guides/horizontal-scaling.mdx:10,13,35` and the diagram at `how-it-works/worker-runner.mdx:55` present `FOR UPDATE SKIP LOCKED` as universal; SQLite uses the write lock and Redis an atomic script.
13. **[docs]** `docs/src/content/docs/integrations/dashboard.tsx` lacks `<ExperimentalAside package="@queuert/dashboard" />` although `createDashboard` is `@experimental`.
14. **[docs]** `docs/src/content/docs/integrations/dashboard.tsx:116-121` doesn't mention the single `POST {basePath}/api/rpc` endpoint; method-based proxy rules from 0.17 no longer separate reads from writes.

### Comparison

15. **[comparison]** `docs/src/data/comparison.ts:3` `comparedQueuertVersion = "0.17.0"` → `"0.18.0"`.
16. **[comparison]** Neighbor versions are stale; release notes checked, no claims change: pg-boss 12.38.0 → 12.38.2 (`comparison.ts:130`, `comparison/pg-boss.tsx:22`), BullMQ 6.7.0 → 6.7.6 (`comparison.ts:178`, `comparison/bullmq.tsx:22`), DBOS 5.4.0 → 5.5.0 (`comparison.ts:202`, `comparison/dbos.tsx:22`).
17. **[comparison]** `docs/src/content/docs/comparison/bullmq.tsx:115` "With Queuert, both halves commit inside your DB transaction" now sits next to a list including the Redis state adapter, which doesn't commit with application data; the matrix (`comparison.ts:105-109`) has the same issue. Qualify to PostgreSQL, SQLite or MySQL/MariaDB. Spot-checked.

### OTEL (all pre-existing in 0.17)

18. **[otel]** `packages/core/src/client/implementation.ts:214-216`: the `await chain.{type}` blocker span ends only on commit; on rollback (and in the `runCreateChains` catch at `:333-336`) it is never ended. Add the rollback handler and end it with ERROR; update `packages/otel/src/specs/otel.spec.ts:2600-2660`.
19. **[otel]** `packages/otel/src/observability-adapter/observability-adapter.otel.ts:364` sets span status OK on success, against the spec section `docs/src/content/docs/integrations/opentelemetry/tracing.tsx:271` cites. Leave UNSET and update `docs/src/data/traces.ts:36,54,92,141`.
20. **[otel]** No `error.type` on `queuert.job.attempt.failed` (`observability-adapter.otel.ts:196-201`), the attempt span (`:360-362`) or the create-job error span (`:313-319`).
21. **[otel]** Counters and up-down counters declare no UCUM `unit` (`observability-adapter.otel.ts:52-76, 91-96`).
22. **[otel]** No `messaging.system` / `messaging.operation.type` on spans or metrics.
23. **[otel]** `metrics.tsx:236-241` cites the messaging conventions but doesn't say why `queuert.job.attempt.duration` / `queuert.job.created` diverge from `messaging.process.duration` / `messaging.client.sent.messages`. Add one sentence.

### Benchmarks

24. **[benchmarks]** TS7 type instantiations grew against `docs/src/data/benchmarks.ts` `typeScenarios`: Linear 1 type 20,015 → 24,846 (+24%), Blockers 25 steps 129,643 → 170,236 (+31%), Branched 4w×3d 66,980 → 75,612 (+13%), Linear 100 74,969 → 82,836 (+10%), Merge 50×50 1,413,540 → 1,505,183 (+6%). Check times are flat or lower except Blockers 25 (TS7 182 → 206 ms). Likely from bce5c32c (sync mode) or the codec types; confirm intended and refresh the published numbers.

## Consider for Future

- **[hygiene]** `.changeset/sync-client.md` (~12 bullets) and `.changeset/codec-job-types.md` (8 bullets, including migration steps) stretch the one-paragraph + flat-list cap.
- **[hygiene]** `.changeset/redis-state-adapter.md`: make it clear the last bullet is the `queuert` patch part.
- **[hygiene]** `.changeset/mysql-adapter.md`: move the PG/SQLite migrator-conformance bullet into `public-migrator.md`.
- **[hygiene]** Four dashboard changesets; fold the patch ones into one line.
- **[api]** Redis adapter isn't generic over `TJobId`/`TWorkerId` (`state-adapter.redis.ts:270,325`).
- **[api]** Redis factory validation throws `Error` without prefix for `keyPrefix` (`:361-363`) but prefixed `TypeError` for `maxTransactionTries` (`:366-368`).
- **[api]** MySQL option TSDoc thinner than PG's (`state-adapter.mysql.ts:375-381`, `:1993`).
- **[api]** No `classifyErrorGroup` in MySQL provider conformance (`packages/mysql/src/conformance/state-provider-conformance.ts:70-79`).
- **[api]** Migrator conformance helpers take a provider instance; state-provider helpers take a factory.
- **[api]** SQLite conformance context's `createStateProvider` returns `MaybePromise<Provider & AsyncDisposable>`; others return `Promise<Provider>`.
- **[api]** Adapter `conformance-internal` subpaths ship only for workspace benchmarks; drop from published output or mark `@internal`.
- **[api]** `code-style.md:158-180` export table is stale (lists `RedisTransaction`, omits `@queuert/mysql` and `RuntimeType`).
- **[api]** `createPgStateAdapter` spells out its return type instead of `PgStateAdapter` (`state-adapter.pg.ts:455-463`).
- **[docs]** `docs/src/components/integrations/state-adapters/stateProvider.tsx:130,135` call the `classifyError` field `table`; it is `tableName`.
- **[docs]** `how-it-works/job-processing.mdx:103` lists only PostgreSQL as READ COMMITTED-only; MySQL/MariaDB too.
- **[docs]** `postgres.tsx:217-220` omits the READ COMMITTED `withTransaction` conformance case.
- **[docs]** Redis key list in `redis.tsx` (~76-150) omits `index-rebuild:<key>`.
- **[docs]** `guides/tx-hooks.mdx:71` Manual tab uses `"BEGIN"`; use `"BEGIN ISOLATION LEVEL READ COMMITTED"`.
- **[docs]** Many guide snippets use plain `sql.begin(async …)`; add one note near `tx-hooks.mdx:43` linking the isolation-level section.
- **[docs]** `integrations/index.tsx:41-42` and `AdapterLayers.tsx:99` say `createWorkerRunner` consumes adapters; it takes only `client`.
- **[docs]** `AdapterLayers.tsx:29,92` notify backend list omits IPC.
- **[docs]** `logging.tsx:111-140` and `observability.tsx:108-113` don't say `input`/`output` are the encoded form.
- **[docs]** `blog/post-commit-side-effects.mdx:185` still describes notifications registered via `withTxHooks`; now via the provider's `onTransactionCommit`.
- **[comparison]** `comparison.ts:118` wakeup cell doesn't mention in-process wakeup by default.
- **[comparison]** Prose omits IPC: `pg-boss.tsx:111`, `bullmq.tsx:106,162-163`, `dbos.tsx:114-115`, `getting-started/introduction.md:110`.
- **[comparison]** `pg-boss.tsx:111-113` still says waking needs a notify adapter; align with `dbos.tsx:156-157`.
- **[comparison]** `comparison.ts:121`, `bullmq.tsx:124` list Node.js and Bun only; browsers now run the in-process path.
- **[schema]** PG `classifyError` regex (`state-provider.pg-pool.ts:68` and the example providers) depends on English `lc_messages`; also match 42P01 by fence table name in `isFenceError`.
- **[otel]** `implementation.ts:242` records "savepoint rolled back" on a full transaction rollback.
- **[otel]** `observability-adapter.otel.ts:14` serializes `traceFlags` in decimal; use `toString(16).padStart(2, "0")`.
- **[otel]** Blocker `complete chain.{type}` CONSUMER span carries no attributes (`:440-446`).
- **[otel]** `start job-attempt.{type}` doesn't follow `{operation} {destination}`; consider `process job.{type}` in a later major.
- **[local]** `examples/state-postgres-kysely-implicit-hooks/` is an untracked leftover (only `node_modules`, `tsconfig.tsbuildinfo`); delete it locally.

## Changesets

31 pending changesets. Every user-facing change has one, and breaking changes are `major`. The linked group would version everything 1.0.0; the release skill's pre-1.0 rule rewrites that to **0.18.0**, so the hygiene agent's 1.0.0 warning was dropped.

| Changeset                   | Packages / bump                                    | Covers                                       |
| --------------------------- | -------------------------------------------------- | -------------------------------------------- |
| adapters-async-dispose      | queuert major; postgres, sqlite, redis, nats minor | async-disposable adapters                    |
| browser-runtime             | queuert patch                                      | no Node built-ins                            |
| chain-tail-jobs             | queuert minor                                      | `getChainTailJob(s)`                         |
| codec-job-types             | queuert major                                      | encode/decode codec, JSON-serializable types |
| conformance-adapter-options | postgres, mysql, sqlite, redis minor               | `stateAdapterOptions` on conformance helpers |
| dashboard-rpc               | dashboard major                                    | single RPC endpoint                          |
| dashboard-theme-sync        | dashboard patch                                    | cross-tab theme sync                         |
| deduplicated-chain-tail     | postgres, sqlite patch                             | dedup returns the real tail                  |
| drop-adapter-truncate       | postgres, sqlite major                             | `truncate()` removed                         |
| drop-tokenless-sweep        | queuert, postgres, sqlite major                    | pre-0.17 tokenless reclaim removed           |
| end-to-end-conformance      | queuert major                                      | end-to-end conformance cases                 |
| in-process-adapters         | queuert major                                      | sync mode and in-process adapters            |
| in-process-notify-default   | queuert major                                      | default in-process notify                    |
| layered-conformance         | queuert major; postgres, sqlite, redis minor       | case-list conformance suites                 |
| mysql-adapter               | mysql minor; postgres, sqlite patch                | new MySQL/MariaDB adapter                    |
| node-24-minimum             | all 7 existing packages major                      | Node 24 minimum                              |
| notify-unsubscribe-errors   | queuert patch                                      | unsubscribe failures logged                  |
| pg-read-committed-providers | postgres patch                                     | explicit READ COMMITTED                      |
| provider-tx-callbacks       | queuert, postgres, sqlite major                    | provider-owned commit/rollback callbacks     |
| public-migrator             | postgres, sqlite minor                             | exported migrators                           |
| publish-ipc                 | ipc minor                                          | new IPC notify package                       |
| redis-state-adapter         | redis minor; queuert patch                         | Redis state adapter                          |
| runtime-performance         | queuert, postgres, sqlite patch                    | CPU and allocation cuts                      |
| schema-fencing              | queuert minor; postgres, sqlite major              | schema write fence and squashed migrations   |
| sqlite-write-lock-sentinel  | sqlite patch                                       | write-lock sentinel                          |
| sync-async-function-names   | queuert, postgres, mysql, sqlite, redis patch      | named compiled functions                     |
| sync-client                 | queuert, sqlite major; dashboard patch             | synchronous client mode                      |
| sync-factories              | queuert plus 6 adapters major                      | synchronous factories                        |
| tx-hooks                    | queuert major; dashboard patch                     | tx hooks rename and `retryBoundary`          |
| worker-runner               | queuert major                                      | `createWorkerRunner`                         |

## Benchmarks

Processing capacity, runtime performance and type complexity ran clean. Query performance was skipped because its numbers were regenerated in 1460f762; its PostgreSQL pass completed before the run was stopped.

- **Processing capacity:** no regressions. In-process completion is 148–166k jobs/s against the published 101–106k. IPC completion is 108–125k against 70–82k, and in-process notify completion is 119–133k against 62–92k. Notify-adapter batched creation is 193–226k against 149–162k. MySQL/MariaDB are 10–13% lower in a few scenarios (e.g. MariaDB complete-noop-1 159 vs 182), which is within container noise. The published in-process numbers understate current throughput, so refresh them.
- **Runtime performance:** allocation per job is within noise everywhere except state-postgres, which is 131.5 → 145.0 KB (+10%). For CPU per job, state-postgres adapter time is 32 → 56 µs while its total is flat. state-mysql is about 30% higher across all categories, but state-mariadb on the same code is flat, so it is probably a noisy run.
- **Type complexity:** instantiation growth, see Should Fix #24.
