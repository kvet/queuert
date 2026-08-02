import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type BlockerReference } from "../errors.js";
import { type OrderDirection, type Page, type PageParams } from "../pagination.js";

export type StateJob = {
  id: string;
  typeName: string;
  chainId: string;
  chainTypeName: string;

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

  deduplicationKey: string | null;

  chainTraceContext: string | null;
  traceContext: string | null;
};

/** Base type for state adapter contexts. */
export type BaseTxContext = Record<string, unknown>;

/**
 * Read-only methods take an optional `txCtx` — omitting it lets the adapter run on
 * its own connection. Mutating methods require one: they must be committed or rolled
 * back together with the caller's other writes.
 */
type ReadTxContextParam<TTxContext extends BaseTxContext> = { txCtx?: TTxContext };

/**
 * A write-intent lock only lasts as long as the transaction that took it, so `lock`
 * requires a `txCtx`. With one, any `lock` value passes — no narrowing needed.
 */
type LockTxContextParam<TTxContext extends BaseTxContext> =
  | { lock?: "exclusive"; txCtx: TTxContext }
  | { lock?: undefined; txCtx?: TTxContext };

type WriteTxContextParam<TTxContext extends BaseTxContext> = { txCtx: TTxContext };

/**
 * Abstracts database operations for job persistence.
 *
 * @typeParam TTxContext - The transaction context type
 * @typeParam TJobId - The job ID type
 */
export type StateAdapter<TTxContext extends BaseTxContext, TJobId extends string> = {
  /** Whether two `withTransaction` callbacks can run concurrently. */
  transactionConcurrency: "concurrent" | "serialized";

  /** Executes a callback within a transaction. Commits on success, rolls back on error. */
  withTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /** Wraps a callback in a savepoint. Rolls back to the savepoint on error and re-throws. */
  withSavepoint: <T>(txCtx: TTxContext, fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /**
   * Gets chains by their IDs. Returns `[headJob, tailJob]` per id in input order,
   * or `undefined` for missing chains. Pass `lock: "exclusive"` to acquire a
   * write-intent lock on the latest job in each chain.
   */
  getChains: (
    params: { chainIds: TJobId[] } & LockTxContextParam<TTxContext>,
  ) => Promise<([StateJob, StateJob | undefined] | undefined)[]>;

  /**
   * Gets chains by deduplication options, scoped to a chain type. Each entry resolves to
   * the single chain a `createChains` of `chainTypeName` with the same options would
   * deduplicate onto — the newest match in scope.
   *
   * Returns `[headJob, tailJob]` per entry in input order, or `undefined` where nothing
   * matches. Pass `lock: "exclusive"` to acquire a write-intent lock on the latest job in
   * each resolved chain.
   */
  getChainsByDeduplication: (
    params: {
      chainTypeName: string;
      deduplications: DeduplicationOptions<TJobId>[];
    } & LockTxContextParam<TTxContext>,
  ) => Promise<([StateJob, StateJob | undefined] | undefined)[]>;

  /**
   * Gets jobs by their IDs. Returns one entry per id in input order, or `undefined`
   * for missing jobs. Pass `lock: "exclusive"` to acquire a write-intent lock.
   */
  getJobs: (
    params: { jobIds: TJobId[] } & LockTxContextParam<TTxContext>,
  ) => Promise<(StateJob | undefined)[]>;

  /**
   * Creates each chain's first job. Returns results in input order.
   * Supports deduplication — matching entries return the existing row with `deduplicated: true`.
   */
  createChains: (params: {
    txCtx: TTxContext;
    jobs: {
      typeName: string;
      id?: TJobId;
      input: unknown;
      schedule?: ScheduleOptions;
      chainTraceContext?: string | null;
      traceContext?: string | null;
      chainTypeName: string;
      deduplication?: DeduplicationOptions<TJobId>;
    }[];
  }) => Promise<{ job: StateJob; deduplicated: boolean }[]>;

  /**
   * Creates the successor job of `continueFromId` within the same chain.
   * Idempotent — if a successor already exists, returns it with `deduplicated: true`.
   */
  createContinuationJob: (params: {
    txCtx: TTxContext;
    job: {
      typeName: string;
      id?: TJobId;
      input: unknown;
      schedule?: ScheduleOptions;
      chainTraceContext?: string | null;
      traceContext?: string | null;
      continueFromId: TJobId;
    };
  }) => Promise<{ job: StateJob; deduplicated: boolean }>;

  /** Adds blocker dependencies to jobs. Returns results in input order. */
  addJobsBlockers: (params: {
    txCtx: TTxContext;
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

  /** Gets the blocker chains for a job. */
  getJobBlockers: (
    params: { jobId: TJobId } & ReadTxContextParam<TTxContext>,
  ) => Promise<[StateJob, StateJob | undefined][]>;

  /** Unblocks jobs when a blocker chain completes, transitioning them from blocked to pending. */
  unblockJobs: (
    params: { blockedByChainId: TJobId } & WriteTxContextParam<TTxContext>,
  ) => Promise<{ unblockedJobs: StateJob[]; blockerTraceContexts: (string | null)[] }>;

  /**
   * Atomically selects a pending job and starts an attempt. Two parallel callers
   * must never receive the same job — locked rows must be skipped, not waited on.
   */
  startJobAttempt: (
    params: { typeNames: string[]; workerId: string } & WriteTxContextParam<TTxContext>,
  ) => Promise<{ job: StateJob | undefined }>;

  /** Extends a running job attempt's deadline. */
  extendJobAttempt: (
    params: {
      jobId: TJobId;
      workerId: string;
      timeoutMs: number;
    } & WriteTxContextParam<TTxContext>,
  ) => Promise<StateJob>;

  /**
   * Finishes a job attempt. Outcome is discriminated by key:
   * - `{ output }` — completed with terminal output
   * - `{ continuedToId }` — completed with successor link
   * - `{ error, schedule }` — failed, returned to pending
   */
  finishJobAttempt: (
    params: {
      jobId: TJobId;
      workerId: string | null;
      outcome:
        | { output: unknown; continuedToId?: never; error?: never; schedule?: never }
        | { continuedToId: TJobId; output?: never; error?: never; schedule?: never }
        | { error: string; schedule?: ScheduleOptions; output?: never; continuedToId?: never };
    } & WriteTxContextParam<TTxContext>,
  ) => Promise<StateJob>;

  /** Releases an expired job attempt back to the pending pool. */
  reclaimExpiredJobAttempt: (
    params: {
      typeNames: string[];
      ignoredJobIds?: TJobId[];
    } & WriteTxContextParam<TTxContext>,
  ) => Promise<StateJob | undefined>;

  /** Ms until a pending job of these types can be attempted: 0 if due now, null if none. */
  getStartAttemptDelayMs: (
    params: { typeNames: string[] } & ReadTxContextParam<TTxContext>,
  ) => Promise<number | null>;

  /** Reschedules pending jobs. Skips non-pending and missing ids. Returns updated rows in input order. */
  rescheduleJobs: (
    params: {
      jobIds: TJobId[];
      schedule?: ScheduleOptions;
    } & WriteTxContextParam<TTxContext>,
  ) => Promise<StateJob[]>;

  /**
   * Deletes all jobs in the given chains atomically. Fails with `blockerRefs` if any
   * chain is referenced as a blocker by a job outside the set. `cascade` includes
   * transitive dependencies.
   */
  deleteChains: (
    params: { chainIds: TJobId[]; cascade?: boolean } & WriteTxContextParam<TTxContext>,
  ) => Promise<{
    deleted: [StateJob, StateJob | undefined][];
    blockerRefs: BlockerReference[];
  }>;

  /** Lists chains with pagination, status-dependent ordering, and filtering. */
  listChains: (
    params: ReadTxContextParam<TTxContext> & {
      typeName?: string[];
      independent?: boolean;
      chainId?: TJobId[];
      from?: Date;
      to?: Date;
      orderDirection: OrderDirection;
      page: PageParams;
    } & (
        | { status?: undefined; orderBy: "createdAt" }
        | { status: "running"; orderBy: "createdAt" }
        | { status: "completed"; orderBy: "createdAt" | "completedAt" }
      ),
  ) => Promise<Page<[StateJob, StateJob | undefined]>>;

  /** Lists jobs with pagination, status-dependent ordering, and filtering. */
  listJobs: (
    params: ReadTxContextParam<TTxContext> & {
      typeName?: string[];
      chainTypeName?: string[];
      chainId?: TJobId[];
      jobId?: TJobId[];
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
  ) => Promise<Page<StateJob>>;

  /** Lists jobs within a specific chain, ordered by position in the chain. */
  listChainJobs: (
    params: {
      chainId: TJobId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & ReadTxContextParam<TTxContext>,
  ) => Promise<Page<StateJob>>;

  /** Lists jobs that depend on the given chain as a blocker. */
  listBlockedJobs: (
    params: {
      chainId: TJobId;
      orderDirection: OrderDirection;
      page: PageParams;
    } & ReadTxContextParam<TTxContext>,
  ) => Promise<Page<StateJob>>;

  /** Releases internal resources. Idempotent. */
  close: () => Promise<void>;
};

export type GetStateAdapterTxContext<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer TTxContext, any> ? TTxContext : never;

export type GetStateAdapterJobId<TStateAdapter> =
  TStateAdapter extends StateAdapter<any, infer TJobId> ? TJobId : never;
