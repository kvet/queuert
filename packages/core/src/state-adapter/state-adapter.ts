import { type ScheduleOptions } from "../entities/schedule.js";
import { type BlockerReference } from "../errors.js";
import { type OrderDirection, type Page, type PageParams } from "../pagination.js";

export type StateJobStatus = "blocked" | "pending" | "running" | "completed";

export type StateJob = {
  id: string;
  typeName: string;
  chainId: string;
  chainTypeName: string;
  continuedToJobId: string | null;
  input: unknown;
  output: unknown;

  status: StateJobStatus;
  createdAt: Date;
  scheduledAt: Date;
  completedAt: Date | null;
  completedBy: string | null;

  attempt: number;
  lastAttemptError: string | null;
  lastAttemptAt: Date | null;

  leasedBy: string | null;
  leasedUntil: Date | null;

  deduplicationKey: string | null;

  chainTraceContext: string | null;
  traceContext: string | null;
};

/** Base type for state adapter contexts. */
export type BaseTxContext = Record<string, unknown>;

/**
 * Abstracts database operations for job persistence.
 *
 * Allows different database implementations (PostgreSQL, SQLite, in-memory).
 * Handles job creation, status transitions, leasing, and queries.
 *
 * All operation methods have an optional `txCtx` parameter:
 * - When txCtx is provided (from within `withTransaction`), operations use that transaction
 * - When txCtx is omitted, the adapter acquires its own connection, executes, and releases
 *
 * @typeParam TTxContext - The transaction context type containing database client/session info
 * @typeParam TJobId - The job ID type used for input parameters
 */
export type StateAdapter<TTxContext extends BaseTxContext, TJobId extends string> = {
  /**
   * Executes a callback within a database transaction.
   * Acquires a connection, starts a transaction, executes the callback,
   * commits on success, rolls back on error, and releases the connection.
   */
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Wraps a callback in a savepoint within an existing transaction.
   * On success, releases the savepoint. On error, rolls back to the savepoint
   * and re-throws. Used to isolate user callbacks and to roll back completion
   * side effects when a handler throws after calling complete().
   */
  withSavepoint: <T>(txCtx: TTxContext, fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Gets a chain by its chain ID. Returns [rootJob, lastJob] or undefined.
   *
   * Pass `lock: "exclusive"` from inside a transaction to acquire a write-intent
   * lock on the latest job in the chain — i.e. the row callers typically extend
   * (rootJob when the chain has no continuation, otherwise the last
   * continuation). The rootJob is not locked when a continuation exists, since
   * `chainTypeName` is immutable and no caller mutates the rootJob via this
   * path. Backends that support row-level locking (Postgres, MySQL/MariaDB)
   * block concurrent locked reads on the same row until the transaction ends.
   */
  getChain: (params: {
    txCtx?: TTxContext;
    chainId: TJobId;
    lock?: "exclusive";
  }) => Promise<[StateJob, StateJob | undefined] | undefined>;

  /**
   * Gets a job by its ID.
   *
   * Pass `lock: "exclusive"` from inside a transaction to acquire a write-intent
   * lock on the row; backends that support row-level locking (Postgres,
   * MySQL/MariaDB) will block concurrent writers until the transaction ends.
   */
  getJob: (params: {
    txCtx?: TTxContext;
    jobId: TJobId;
    lock?: "exclusive";
  }) => Promise<StateJob | undefined>;

  /**
   * Creates jobs. Returns results in the same order as input.
   *
   * Each input is one of two shapes, distinguished structurally:
   * - **chain start** (`chainTypeName` present): first job in a new chain.
   *   Adapter generates the chain's id (job's id == chain id), uses the
   *   provided `chainTypeName`. Supports deduplication.
   * - **continuation** (`continueFromJobId` present): successor of an existing
   *   job. Adapter looks up `continueFromJobId` to inherit `chainId` and
   *   `chainTypeName`, and sets the parent's `continuedToJobId` to the new
   *   job's id.
   *
   * Each entry may also provide an `id` to assign explicitly; if omitted, the adapter
   * generates one via its configured `generateId`. Both caller-supplied and
   * generated IDs are validated via {@link validateId}, throwing `InvalidJobIdError`
   * before any database write. When `id` is supplied for an entry that turns out to
   * be deduplicated, the returned job carries the existing row's ID (not the
   * caller's) and `deduplicated: true`.
   */
  createJobs: (params: {
    txCtx?: TTxContext;
    jobs: ({
      typeName: string;
      id?: TJobId;
      input: unknown;
      schedule?: ScheduleOptions;
      chainTraceContext?: string | null;
      traceContext?: string | null;
    } & (
      | {
          chainTypeName: string;
          deduplication?: {
            key: string;
            scope?: "incomplete" | "any";
            windowMs?: number;
            excludeChainIds?: TJobId[];
          };
        }
      | {
          continueFromJobId: TJobId;
        }
    ))[];
  }) => Promise<{ job: StateJob; deduplicated: boolean }[]>;

  /** Adds blocker dependencies to jobs. Returns results in the same order as input. */
  addJobsBlockers: (params: {
    txCtx?: TTxContext;
    jobBlockers: {
      jobId: TJobId;
      blockedByChainIds: TJobId[];
      blockerTraceContexts?: (string | null)[];
    }[];
  }) => Promise<
    {
      job: StateJob;
      incompleteBlockerChainIds: string[];
      blockerChainTraceContexts: (string | null)[];
    }[]
  >;

  /** Unblocks jobs when a blocker chain completes, transitioning them from blocked to pending. */
  unblockJobs: (params: {
    txCtx?: TTxContext;
    blockedByChainId: TJobId;
  }) => Promise<{ unblockedJobs: StateJob[]; blockerTraceContexts: (string | null)[] }>;

  /** Gets the blocker chains for a job. */
  getJobBlockers: (params: {
    txCtx?: TTxContext;
    jobId: TJobId;
  }) => Promise<[StateJob, StateJob | undefined][]>;

  /** Gets the time in ms until the next job is available, or null if none. */
  getNextJobAvailableInMs: (params: {
    txCtx?: TTxContext;
    typeNames: string[];
  }) => Promise<number | null>;

  /**
   * Acquires a pending job for processing. Returns the job and whether more
   * jobs are waiting.
   *
   * Implicit-lock contract: must atomically select a pending row and flip its
   * status to `running` (typically a single `FOR UPDATE SKIP LOCKED` + `UPDATE`
   * on Postgres/MySQL). Two parallel callers must never receive the same job,
   * and a row already locked by another caller must be *skipped* rather than
   * waited on — otherwise concurrent workers serialize on contended rows
   * instead of fanning out across the queue.
   */
  acquireJob: (params: {
    txCtx?: TTxContext;
    typeNames: string[];
  }) => Promise<{ job: StateJob | undefined; hasMore: boolean }>;

  /** Renews the lease on a running job. */
  renewJobLease: (params: {
    txCtx?: TTxContext;
    jobId: TJobId;
    workerId: string;
    leaseDurationMs: number;
  }) => Promise<StateJob>;

  /** Reschedules a job for later processing. */
  rescheduleJob: (params: {
    txCtx?: TTxContext;
    jobId: TJobId;
    schedule: ScheduleOptions;
    error: string;
  }) => Promise<StateJob>;

  /** Completes a job with the given output. */
  completeJob: (params: {
    txCtx?: TTxContext;
    jobId: TJobId;
    output: unknown;
    workerId: string | null;
  }) => Promise<StateJob>;

  /**
   * Removes an expired lease and resets the job to pending.
   *
   * Implicit-lock contract: same shape as `acquireJob` — atomic select-and-update
   * on a single row, skipping rows already locked by another caller rather than
   * waiting on them, so parallel reapers don't bottleneck on the same expired
   * row.
   */
  reapExpiredJobLease: (params: {
    txCtx?: TTxContext;
    typeNames: string[];
    ignoredJobIds?: TJobId[];
  }) => Promise<StateJob | undefined>;

  /**
   * Deletes all jobs in the given chains in a single atomic operation.
   *
   * All-or-nothing: if any chain in the effective set is referenced as a blocker
   * by a job outside the set, nothing is deleted and `blockerRefs` lists the
   * offending references. When deletion proceeds, missing ids are silently
   * skipped and `blockerRefs` is empty. When `cascade` is true, expands
   * `chainIds` to include transitive dependencies (downward only) before
   * checking and deleting.
   */
  deleteChains: (params: { txCtx?: TTxContext; chainIds: TJobId[]; cascade?: boolean }) => Promise<{
    deleted: [StateJob, StateJob | undefined][];
    blockerRefs: BlockerReference[];
  }>;

  /** Lists chains with pagination and filtering. */
  listChains: (params: {
    txCtx?: TTxContext;
    filter?: {
      typeName?: string[];
      status?: StateJobStatus[];
      rootOnly?: boolean;
      chainId?: string[];
      jobId?: string[];
      from?: Date;
      to?: Date;
    };
    orderDirection: OrderDirection;
    page: PageParams;
  }) => Promise<Page<[StateJob, StateJob | undefined]>>;

  /** Lists jobs with pagination and filtering. */
  listJobs: (params: {
    txCtx?: TTxContext;
    filter?: {
      status?: StateJobStatus[];
      typeName?: string[];
      chainTypeName?: string[];
      chainId?: string[];
      jobId?: string[];
      from?: Date;
      to?: Date;
    };
    orderDirection: OrderDirection;
    page: PageParams;
  }) => Promise<Page<StateJob>>;

  /** Lists jobs within a specific chain, ordered by chain index. */
  listChainJobs: (params: {
    txCtx?: TTxContext;
    chainId: TJobId;
    orderDirection: OrderDirection;
    page: PageParams;
  }) => Promise<Page<StateJob>>;

  /** Lists jobs that depend on the given chain as a blocker. */
  listBlockedJobs: (params: {
    txCtx?: TTxContext;
    chainId: TJobId;
    orderDirection: OrderDirection;
    page: PageParams;
  }) => Promise<Page<StateJob>>;

  /**
   * Triggers pending jobs immediately by setting their scheduledAt to now.
   *
   * All-or-nothing: if any input id is missing or not in `pending` status, no
   * rows are updated and `triggered` is empty. `notFound` lists ids with no
   * matching job; `notTriggerable` lists existing jobs whose status is not
   * `pending`. When every input is eligible, `triggered` contains the updated
   * jobs in the same order as `jobIds`. Never throws on missing/ineligible
   * ids — the caller decides how to surface failures.
   */
  triggerJobs: (params: { txCtx?: TTxContext; jobIds: TJobId[] }) => Promise<{
    triggered: StateJob[];
    notFound: TJobId[];
    notTriggerable: { id: TJobId; status: StateJobStatus }[];
  }>;

  /**
   * Releases internal resources (in-memory indexes, shared caches) and cascades
   * into the underlying provider. Idempotent — the second call is a no-op.
   * After close, other methods may reject.
   */
  close: () => Promise<void>;
};

export type GetStateAdapterTxContext<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer TTxContext, any> ? TTxContext : never;

export type GetStateAdapterJobId<TStateAdapter> =
  TStateAdapter extends StateAdapter<any, infer TJobId> ? TJobId : never;
