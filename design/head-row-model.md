# Head-row chain model

The head job row becomes the chain container. Its `type_name` is the chain type, its
`chain_completed_at` is the chain's completion, and no chain-level fact is duplicated onto
continuation rows. `StateAdapter` stops smuggling chain fields inside `StateJob` and returns an
explicit `{ chain, head, tail }`.

Closes `[REF] Move chain information to the head row`, the `rework StateAdapter` block, and the
`acquireJob returns 'hasBlockers'` / `completeJobs return 'hasBlocked'` items in `TODO.md`.

Evidence: `spikes/chain-identity` (see its README and `src/head-row-opt.ts`). Head row beats a
separate chain table on storage at every chain length; the tuned variant is −12.9% storage and
−37% WAL per single-job round against the naive head row.

## Entities

```ts
export type StateJob = {
  id: string;
  typeName: string;
  chainId: string;

  blocked: boolean;
  createdAt: Date;
  input: unknown;
  scheduledAt: Date;

  completedAt: Date | null;
  completedBy: string | null;
  continuedToId: string | null;
  output: unknown;

  attempt: number;
  lastAttemptError: string | null;
  lastAttemptAt: Date | null;

  attemptAt: Date | null;
  attemptBy: string | null;
  attemptUntil: Date | null;

  traceContext: string | null;
};

export type StateChain = {
  id: string; // = head job id
  typeName: string; // = head job type_name
  deduplicationKey: string | null;
  createdAt: Date; // = head job created_at
  completedAt: Date | null; // = head job chain_completed_at
  traceContext: string | null;
};

export type StateJobBlocker = {
  jobId: string;
  blockedByChainId: string;
  index: number;
  completed: boolean; // blocker chain's chain_completed_at IS NOT NULL
  traceContext: string | null;
};
```

`StateJob` drops `chainTypeName`, `deduplicationKey` and `chainTraceContext`. Nothing is added.

```ts
/** `tail` is `undefined` when the head is the tail — a single-job chain. */
export type StateChainView = { chain: StateChain; head: StateJob; tail: StateJob | undefined };

/** A job with the chain it belongs to. */
export type StateJobView = { chain: StateChain; job: StateJob };

export type StateCount = { count: number; hasMore: boolean };
```

Every method that returns a job returns a `StateJobView`, so no caller re-fetches a chain to read
its `typeName` or `traceContext`. The write methods extend it: `createJobs` adds `deduplicated`,
`continueJobs` adds `continuation`, `completeJobs` adds `hasBlocking`, `startJobAttempt` adds
`hasBlockers`.

## StateAdapter

```ts
type ReadTxContextParam<T extends BaseTxContext> = { txCtx?: T };
type LockTxContextParam<T extends BaseTxContext> =
  | { lock?: "exclusive"; txCtx: T }
  | { lock?: undefined; txCtx?: T };
type WriteTxContextParam<T extends BaseTxContext> = { txCtx: T };

export type StateAdapter<TTxContext extends BaseTxContext, TJobId extends string> = {
  transactionConcurrency: "concurrent" | "serialized";
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  withSavepoint: <T>(txCtx: TTxContext, fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  // ── Reads ──────────────────────────────────────────────────────────────────

  /**
   * Chains by id, in input order, `undefined` for missing.
   * `lock: "exclusive"` takes a write-intent lock on each chain's head row.
   */
  getChains: (
    params: { chainIds: TJobId[] } & LockTxContextParam<TTxContext>,
  ) => Promise<(StateChainView | undefined)[]>;

  /** Jobs by id, with their chains, in input order, `undefined` for missing. */
  getJobs: (
    params: { jobIds: TJobId[] } & LockTxContextParam<TTxContext>,
  ) => Promise<(StateJobView | undefined)[]>;

  // ── Writes ─────────────────────────────────────────────────────────────────

  /** Creates chain heads. Deduplicated matches return `deduplicated: true`. */
  createJobs: (params: {
    txCtx: TTxContext;
    jobs: {
      typeName: string;
      id?: TJobId;
      input: unknown;
      schedule?: ScheduleOptions;
      deduplication?: DeduplicationOptions;
      traceContext?: string | null;
      chainTraceContext?: string | null;
    }[];
  }) => Promise<(StateJobView & { deduplicated: boolean })[]>;

  /** Completes each `continueFromId` and inserts its chain successor, linking the two. */
  continueJobs: (params: {
    txCtx: TTxContext;
    completedBy?: string | null;
    jobs: {
      typeName: string;
      id?: TJobId;
      input: unknown;
      schedule?: ScheduleOptions;
      traceContext?: string | null;
      continueFromId: TJobId;
    }[];
  }) => Promise<(StateJobView & { continuation: StateJob })[]>;

  /**
   * Completes each job with its terminal output, ending its chain and setting the
   * chain's `completedAt`. `hasBlocking` reports whether any job depends on the
   * chain, gating `unblockJobs`. Handing a chain on is `continueJobs`, not this.
   */
  completeJobs: (
    params: {
      completedBy?: string | null;
      jobs: { jobId: TJobId; output: unknown }[];
    } & WriteTxContextParam<TTxContext>,
  ) => Promise<(StateJobView & { hasBlocking: boolean })[]>;

  /** Returns jobs to pending, clearing any running attempt. Skips completed and missing ids. */
  rescheduleJobs: (
    params: {
      jobs: { jobId: TJobId; schedule?: ScheduleOptions; error?: string }[];
    } & WriteTxContextParam<TTxContext>,
  ) => Promise<StateJobView[]>;

  /**
   * Deletes all jobs in the given chains atomically. Fails with `blockerRefs` if any
   * chain is referenced as a blocker by a job outside the set. `cascade` includes
   * transitive dependencies.
   */
  deleteChains: (
    params: { chainIds: TJobId[]; cascade?: boolean } & WriteTxContextParam<TTxContext>,
  ) => Promise<{ deleted: StateChainView[]; blockerRefs: BlockerReference[] }>;

  // ── Attempts ───────────────────────────────────────────────────────────────

  /**
   * Atomically selects a pending job and starts an attempt, returning it with its
   * chain. Two parallel callers must never receive the same job — locked rows must
   * be skipped, not waited on. `hasBlockers` gates `getJobBlockers`.
   */
  startJobAttempt: (
    params: { typeNames: string[]; workerId: string } & WriteTxContextParam<TTxContext>,
  ) => Promise<(StateJobView & { hasBlockers: boolean }) | undefined>;

  /** Ms until a pending job of these types can be attempted: 0 if due now, null if none. */
  getStartAttemptDelayMs: (
    params: { typeNames: string[] } & ReadTxContextParam<TTxContext>,
  ) => Promise<number | null>;

  /** Extends a running job attempt's deadline. */
  extendJobAttempt: (
    params: {
      jobId: TJobId;
      workerId: string;
      timeoutMs: number;
    } & WriteTxContextParam<TTxContext>,
  ) => Promise<StateJob>;

  /** Releases an expired job attempt back to the pending pool. */
  reclaimExpiredJobAttempt: (
    params: { typeNames: string[]; ignoredJobIds?: TJobId[] } & WriteTxContextParam<TTxContext>,
  ) => Promise<StateJobView | undefined>;

  // ── Blockers ───────────────────────────────────────────────────────────────

  /**
   * Adds blocker dependencies to jobs, in input order. Throws `ChainNotFoundError`
   * if any `blockedByChainIds` entry does not exist — the check
   * `blocked_by_chain_id`'s dropped foreign key used to perform.
   */
  addJobsBlockers: (params: {
    txCtx: TTxContext;
    jobBlockers: {
      jobId: TJobId;
      blockedByChainIds: TJobId[];
      blockerTraceContexts?: (string | null)[];
    }[];
  }) => Promise<{ job: StateJob; blockers: StateJobBlocker[] }[]>;

  /** Blocker chains for a job. */
  getJobBlockers: (
    params: { jobId: TJobId } & ReadTxContextParam<TTxContext>,
  ) => Promise<StateChainView[]>;

  /** Unblocks jobs when a blocker chain completes. Gated on `completeJobs`' `hasBlocking`. */
  unblockJobs: (
    params: { blockedByChainId: TJobId } & WriteTxContextParam<TTxContext>,
  ) => Promise<{ unblocked: StateJobView[]; blockers: StateJobBlocker[] }>;

  // ── Queries ────────────────────────────────────────────────────────────────

  /** Distinct chain type names — head rows' `type_name`. */
  listChainTypeNames: (params: ReadTxContextParam<TTxContext>) => Promise<string[]>;

  /** Distinct job type names. */
  listJobTypeNames: (params: ReadTxContextParam<TTxContext>) => Promise<string[]>;

  countByChainTypeNames: (
    params: ReadTxContextParam<TTxContext> & { typeNames: string[] },
  ) => Promise<{ running: StateCount; completed: StateCount }[]>;

  countByJobTypeNames: (
    params: ReadTxContextParam<TTxContext> & { typeNames: string[] },
  ) => Promise<{ pending: StateCount; running: StateCount; completed: StateCount }[]>;

  listChains: (
    params: ReadTxContextParam<TTxContext> & {
      typeName: string;
      independent?: boolean;
      from?: Date;
      to?: Date;
      orderDirection: OrderDirection;
      page: PageParams;
    } & (
        | { status?: undefined; orderBy: "createdAt" }
        | { status: "running"; orderBy: "createdAt" }
        | { status: "completed"; orderBy: "createdAt" | "completedAt" }
      ),
  ) => Promise<Page<StateChainView>>;

  listJobs: (
    params: ReadTxContextParam<TTxContext> & {
      typeName: string;
      from?: Date;
      to?: Date;
      orderDirection: OrderDirection;
      page: PageParams;
    } & (
        | { status?: undefined; orderBy: "createdAt" }
        | { status: "pending"; blocked?: boolean; orderBy: "createdAt" | "scheduledAt" }
        | { status: "running"; orderBy: "createdAt" | "attemptAt" | "attemptUntil" }
        | { status: "completed"; continued?: boolean; orderBy: "createdAt" | "completedAt" }
      ),
  ) => Promise<Page<StateJobView>>;

  listChainJobs: (
    params: {
      chainId: TJobId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & ReadTxContextParam<TTxContext>,
  ) => Promise<Page<StateJobView>>;

  listBlockedJobs: (
    params: {
      chainId: TJobId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & ReadTxContextParam<TTxContext>,
  ) => Promise<Page<StateJobView>>;

  close: () => Promise<void>;
};
```

### Notes on the surface

`continueJobs` drops its `chainTraceContext` input — `createJobs` keeps it, since that is the call
that creates the chain. `continueJobs` and `completeJobs` take one `completedBy` instead of one per
entry.

`extendJobAttempt` deliberately stays `Promise<StateJob>`: it runs on the heartbeat, and the worker
already holds the chain from `startJobAttempt`.

`StateJobView` on the job readers costs a primary-key lookup of the head row per returned row — one
per id for `getJobs`, one per page row for `listJobs` and `listBlockedJobs`. Nothing in core needs
it today; it is for consistency and the dashboard. `listChainJobs` is one chain for the whole page,
so its mapper builds a single `StateChain` and shares the reference.

## Schema

### `job`

Columns ordered `timestamptz → integer → boolean → id → text/jsonb` so fixed-width columns stop
paying alignment padding around the jsonb payloads.

```sql
CREATE TABLE {{schema}}.{{table_prefix}}job (
  created_at          timestamptz NOT NULL DEFAULT now(),
  scheduled_at        timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  last_attempt_at     timestamptz,
  attempt_at          timestamptz,
  attempt_until       timestamptz,
  chain_completed_at  timestamptz,               -- head rows only

  chain_index         integer NOT NULL,
  attempt             integer NOT NULL DEFAULT 0,

  blocked             boolean NOT NULL DEFAULT false,

  id                  {{id_type}} PRIMARY KEY,
  chain_id            {{id_type}} NOT NULL,      -- no FK
  continued_to_id     {{id_type}},               -- no FK

  type_name           text NOT NULL,
  completed_by        text,
  attempt_by          text,
  deduplication_key   text,                      -- head rows only
  chain_trace_context text,                      -- head rows only
  trace_context       text,
  last_attempt_error  jsonb,
  input               jsonb,
  output              jsonb
) WITH (
  fillfactor = 75,
  autovacuum_vacuum_cost_delay = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0
);
```

Against today: `chain_type_name` **deleted**; `chain_completed_at` **added**;
`deduplication_key` / `chain_trace_context` written on head rows only; both self-referential
foreign keys dropped.

### `job_blocker`

```sql
CREATE TABLE {{schema}}.{{table_prefix}}job_blocker (
  job_id              {{id_type}} NOT NULL REFERENCES {{schema}}.{{table_prefix}}job(id),
  blocked_by_chain_id {{id_type}} NOT NULL,      -- no FK
  index               integer NOT NULL,
  trace_context       text,
  PRIMARY KEY (job_id, blocked_by_chain_id, "index")
) WITH ( /* autovacuum tuning unchanged */ );
```

`job_id`'s FK stays: its parent is always a row the same transaction just inserted, so its
`KEY SHARE` never conflicts. `blocked_by_chain_id`'s FK goes: it points cross-transaction at
another chain's head row, which acquisition holds `FOR UPDATE`, and RI checks have no
`SKIP LOCKED`. Its guarantee moves into `addJobsBlockers`, which throws `ChainNotFoundError`.

### Indexes

```sql
-- A head row's (chain_id, 0) is the primary key under another name. Partial, so the
-- index holds nothing at all on a single-job workload.
CREATE UNIQUE INDEX chain_index_idx ON job (chain_id, chain_index) WHERE chain_index > 0;

CREATE INDEX job_idx           ON job (type_name, created_at);
-- Job listing / acquisition: unchanged.
CREATE INDEX job_ready_idx     ON job (type_name, scheduled_at)  WHERE blocked = false AND attempt_at IS NULL AND completed_at IS NULL;
CREATE INDEX job_pending_idx   ON job (type_name, scheduled_at)  WHERE attempt_at IS NULL AND completed_at IS NULL;
CREATE INDEX job_running_idx   ON job (type_name, attempt_until) WHERE attempt_at IS NOT NULL AND completed_at IS NULL;
CREATE INDEX job_completed_idx ON job (type_name, completed_at)  WHERE completed_at IS NOT NULL;

-- Chain listing: head-anchored. Replaces chain_head_idx and both chain_tail_* indexes.
CREATE INDEX chain_idx           ON job (type_name, created_at)         WHERE chain_index = 0;
CREATE INDEX chain_running_idx   ON job (type_name, created_at)         WHERE chain_index = 0 AND chain_completed_at IS NULL;
CREATE INDEX chain_completed_idx ON job (type_name, chain_completed_at) WHERE chain_index = 0 AND chain_completed_at IS NOT NULL;

-- Deduplication: unchanged, already head-only.
CREATE INDEX job_deduplication_idx ON job (deduplication_key, created_at DESC)
  WHERE deduplication_key IS NOT NULL AND chain_index = 0;

CREATE INDEX job_blocker_chain_idx ON job_blocker (blocked_by_chain_id);
```

Dropped: `chain_tail_running_idx`, `chain_tail_completed_idx`, `chain_head_idx`,
`job_continuation_idx`. The last serves no read path — every use of `continued_to_id` in the
adapter is a null test, and nothing traverses continuation links.

`listChains` takes a required `typeName`, so no type-less chain listing index is needed. Both
by-type listing indexes stay: the spike measured collapsing them at **+424%** on
`listChains(50, by type)`.

## Query shapes

### Chain select

```sql
SELECT <chain + head cols from j>, <tail cols from t>
FROM {{schema}}.{{table_prefix}}job j
LEFT JOIN LATERAL (
  SELECT * FROM {{schema}}.{{table_prefix}}job
  WHERE chain_id = j.id AND chain_index > 0
  ORDER BY chain_index DESC LIMIT 1
) t ON TRUE
WHERE j.chain_index = 0
```

`t` missing ⇒ single-job chain ⇒ `tail: undefined`; consumers read `tail ?? head`.

SQLite has no `LATERAL`; the existing `MAX(chain_index)` subqueries
(`state-adapter.sqlite.ts:669,697,1221`) and rowid-subquery join (`:2003,2024`) gain
`AND chain_index > 0`.

The job readers take the head row by primary key instead — `JOIN job h ON h.id = j.chain_id`,
which for a head row is `j` itself.

### Chain completion

One `UPDATE`, per-row `CASE` in the `SET` list. **Never a data-modifying CTE** — for a one-job
chain the head and the completing job are the same row, and a CTE's branches cannot both see it.

```sql
UPDATE {{schema}}.{{table_prefix}}job SET
  completed_at       = CASE WHEN id = $1 THEN now() ELSE completed_at END,
  completed_by       = CASE WHEN id = $1 THEN $3   ELSE completed_by END,
  output             = CASE WHEN id = $1 THEN $2   ELSE output       END,
  chain_completed_at = CASE WHEN chain_index = 0 AND chain_completed_at IS NULL
                            THEN now() ELSE chain_completed_at END
WHERE id = $1 OR id = (SELECT chain_id FROM {{schema}}.{{table_prefix}}job WHERE id = $1)
```

Multi-job chain: two rows. One-job chain: both disjuncts name the same row, both effects land.
Needs a regression test for a one-job chain specifically — the multi-job test passes either way.

### Blocker fast paths

Both flags are `EXISTS` probes inside statements the caller already issues. Neither is a column.

```sql
-- in startJobAttempt, on the acquired job:
EXISTS (SELECT 1 FROM job_blocker WHERE job_id = j.id)                    AS has_blockers
-- in completeJobs, on the completing chain:
EXISTS (SELECT 1 FROM job_blocker WHERE blocked_by_chain_id = j.chain_id) AS has_blocking
```

`has_blockers` descends `job_blocker`'s primary key (leading column `job_id`); `has_blocking` uses
`job_blocker_chain_idx`.

### Blocker completeness

`addJobsBlockers`' `blockers_status` and `per_job_trace_contexts` CTEs
(`state-adapter.pg.ts:1370-1376`) collapse into one join against the blocker chain's head row:
`completed` is `chain_completed_at IS NOT NULL`, `traceContext` is `chain_trace_context`, and a
row missing from the join raises `ChainNotFoundError`, rolling the transaction back — the same
outcome the foreign key produces today.

## What this optimizes

| #   | change                             | mechanism                                                                                                                                                                           |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | chain metadata not duplicated      | `chain_type_name` deleted; `chain_trace_context` / `deduplication_key` head-only. Continuations stop carrying two text columns they cannot disagree with                            |
| 2   | chain listing / counting           | tail-anchored (`continued_to_id IS NULL AND completed_at …`) → head-anchored partial index on `chain_completed_at`. `countByChainTypeNames` becomes an index-only scan of head rows |
| 3   | `orderBy: "completedAt"` on chains | today sorts tail rows; now served by `chain_completed_idx`                                                                                                                          |
| 4   | completion path                    | `completeJobs → getJobs → unblockJobs` (3) → `completeJobs` (1), or 2 when `hasBlocking`. `getJobs` was fetching the head purely for `chainTypeName` and its id                     |
| 5   | acquire path                       | `startJobAttempt → getJobBlockers` (2) → 1 when `hasBlockers` is false. Spike prices the unconditional lookup at **13% of throughput**                                              |
| 6   | blocker completeness               | per-blocker tail subquery (`ORDER BY chain_index DESC LIMIT 1`) → head-row column read                                                                                              |
| 7   | `chain_index_idx` partial          | head rows' `(chain_id, 0)` was the primary key re-written under another name. Index is empty on single-job workloads; −28% at 3 jobs/chain                                          |
| 8   | `job_continuation_idx` dropped     | one fewer index entry per continuation                                                                                                                                              |
| 9   | self-FKs dropped                   | no RI probe per insert; no `KEY SHARE` on the parent, which conflicts with `FOR UPDATE`; unblocks partition detach                                                                  |
| 10  | `blocked_by_chain_id` FK dropped   | removes a cross-chain `KEY SHARE` that waits on acquisition's `FOR UPDATE` for the length of a job handler                                                                          |
| 11  | column order                       | fixed-width first, varlena last — no alignment padding around `input`/`output`                                                                                                      |

Measured on the spike's schema (cold-page upper bound; ~22% rather than 37% warm):

| operation              | naive head row | tuned | delta |
| ---------------------- | -------------: | ----: | ----: |
| full round, 1 job      |           7073 |  4485 |  −37% |
| `acquireJob`           |           4930 |  2644 |  −46% |
| `completeChain`, 1 job |           4395 |  2379 |  −46% |
| `createChain`          |           4395 |  2366 |  −46% |
| `continueChain`        |           5008 |  4018 |  −20% |

## Where the chain travels

Every observability event funnels through `mapStateJobToJobBasicData`, which reads
`chainTypeName` (`observability-helper.ts:25-29`) — ~20 call sites. `observabilityHelper`'s
methods change from `(job: StateJob)` to `(chain: StateChain, job: StateJob)`.

A chain is immutable for the life of an attempt (`typeName`, `createdAt`, `traceContext` never
change; only `completedAt` moves, at the end), so the worker carries the chain from
`startJobAttempt` rather than re-fetching it.

| site                                                                                             | chain source                                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| attempt path — `extendJobAttempt`, `jobAttemptFailed`, `jobAttemptExpired`, `jobAttemptDuration` | `startJobAttempt`                                                        |
| `jobBlocked` via `addJobsBlockers`                                                               | the `createJobs` that just ran                                           |
| `jobRescheduled`, worker retry (`job-process.ts:410`)                                            | `startJobAttempt`                                                        |
| `chainDeleted`                                                                                   | `deleteChains` returns views                                             |
| `jobAttemptReclaimed` (`in-process-worker.ts:441`)                                               | **`reclaimExpiredJobAttempt` returns it**                                |
| `jobRescheduled`, client (`client.ts:837`)                                                       | **`rescheduleJobs` returns it**                                          |
| `jobUnblocked`                                                                                   | **`unblockJobs` returns it** — the unblocked jobs belong to other chains |

`extendJobAttempt` stays free of a head-row join, which keeps it off the heartbeat path.

## Invariants

1. **Acquisition implicitly holds a chain lock.** A one-job chain's only job is its head row, so
   `startJobAttempt` locks the chain. Safe under `SKIP LOCKED`, but invisible to the
   `ORDER BY id FOR UPDATE` discipline used elsewhere. Relevant before worker liveness and
   unbounded blockers add more chain-ordered locking.
2. **Acquisition can never be a HOT update.** Taking a job out of the due set changes a column in
   the acquisition index. The spike measures `HOT fraction 0.00` on acquire in every model.

## Migration

The schema is unreleased: `migrations` is a single `001_initial_schema` clean install, bracketed
by a v0.15.1 importer. No expand/contract.

1. **Edit `001_initial_schema` in place** in both adapters.
2. **Update the importer** (`legacy-upgrade.pg.ts:164-183` + sqlite twin), which copies a whole
   chain per statement:
   - drop `o.chain_type_name`;
   - gate `deduplication_key` / `chain_trace_context` on `o.chain_index = 0`;
   - derive `chain_completed_at` — the existing self-join
     (`n.chain_id = o.chain_id AND n.chain_index = o.chain_index + 1`) already identifies the
     successor-less row as `n.id IS NULL`, so the tail's `completed_at` is a window function over
     rows the statement already reads.

   Dropping the self-FKs removes the ordering hazard the comment at `:158-161` describes;
   chain-per-statement batching stays for `job_blocker.job_id`.

3. `packages/postgres/fixtures/v0.15.1.schema.sql` is frozen input; unchanged.
4. Extend `legacy-upgrade.spec.ts` and `state-adapter-migration.spec.ts` parity assertions to
   `chain_completed_at`, including a one-job chain.

## Blast radius

Zero references: `packages/nats`, `packages/redis`. `packages/dashboard` has no direct field or
adapter use — only client return shapes (`api/routes/chains.ts:43-46,68,122,168`,
`api/routes/jobs.ts:123`) plus six raw-adapter seed sites in its spec. `examples/` is
client-level only.

| area                      | sites                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entities/chain.ts:19`    | `mapStatePairToChain` takes `{ chain, head, tail }`; status from `chain.completedAt`. 10 call sites depend on it                                                       |
| `client.ts`               | 5 `chainTypeName` guards (`:888, :1026, :1144, :1401, :1488`), 7 `getChains` sites, `listChains:1289`, `getJobBlockers:1456`, `deleteChains:726`, `rescheduleJobs:833` |
| `observability-helper.ts` | ~20 method signatures gain `chain`; `:29, :58, :492, :495` read the dropped fields. `packages/otel`'s 54 references are payload fields and break only transitively     |
| `implementation/`         | `complete-chain.ts` (loses `getJobs`, gates `unblockJobs`), `create-state-jobs.ts:71,92,271,277,308,311,318,326`, `complete-job.ts:26`, `create-chains.ts:50`          |
| `worker/job-process.ts`   | `:202` blockers (now gated), `:222-227` attempt span, `:429-430` `chainTraceContext` echo disappears                                                                   |
| `in-process-worker.ts`    | `:125` `startJobAttempt`, `:434-441` `reclaimExpiredJobAttempt`                                                                                                        |
| decorators                | `wrapper.logging.ts`, `spy.spec-helper.ts`, `in-process.spec-helper.ts` — re-typed only                                                                                |

Tests: ~7.7k lines of conformance across 26 case files — `list-chains.ts` (1001),
`list-jobs.ts` (821), `create-jobs.ts` (728), `unblock-jobs.ts` (583). Call counts:
`createJobs` ~310, `startJobAttempt` ~80, `listChains` ~62, `completeJobs` ~55,
`continueJobs` ~40, `getChains` ~20, `deleteChains` ~16, `getJobBlockers` ~10. Plus
`suites/index-coverage-cases.ts` (22 `listChains` calls at `:443-702`; asserts index usage, so
every index change lands here), `seed-all-states-v2.ts`, both `fast-seed-all-states-v2.ts`
(~15 INSERT column lists each), `logging.spec.ts`, `otel.spec.ts`, `entities/{chain,job}.spec.ts`.

## Plan

1. **Core types** — `state-adapter.ts`: add `StateChain`, `StateJobBlocker`; strip three fields
   from `StateJob`; re-sign 12 methods; re-type the three decorators.
2. **In-process adapter** — 1281 lines, the reference semantics. Dedup index key
   `${chainTypeName}\0${deduplicationKey}` becomes `${headTypeName}\0${deduplicationKey}`.
3. **Conformance** — 26 case files, plus new cases for one-job chain completion and the
   implicit-chain-lock invariant.
4. **Core consumers** — `entities/chain.ts`, `client.ts`, `observability-helper.ts` (largest
   mechanical edit), `implementation/`, `worker/`, `in-process-worker.ts`.
5. **Postgres** — DDL, indexes, chain select, completion `UPDATE`, the two `EXISTS` probes,
   head-anchored `listChains` / `countByChainTypeNames` / `listChainTypeNames`, `addJobsBlockers`
   collapse, importer, migration specs.
6. **SQLite** — mirror; lateral translated, `MAX(chain_index)` sites updated. `fillfactor` and
   column alignment do not apply. Only `job_blocker.job_id`'s FK survives, so
   `sqlite-internals.md`'s `PRAGMA foreign_keys = ON` caveat now guards only a same-transaction
   reference.
7. **Docs + changeset** — `chain-model.md` (claims chains are a pure view with no chain state),
   `postgres-internals.md`, `sqlite-internals.md`, `adapters.md`, `otel-internals.md`,
   `logging.md`. One `major` changeset across `queuert`, `@queuert/postgres`, `@queuert/sqlite`.
