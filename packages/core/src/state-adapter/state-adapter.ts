import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type OrderDirection, type Page, type PageParams } from "../pagination.js";

// TODO!!!: one line doc comments

export type StateJobInfo = {
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

export type StateChainInfo = {
  id: string;
  typeName: string;
  deduplicationKey: string | null;
  createdAt: Date;
  completedAt: Date | null;
  traceContext: string | null;
};

export type StateJobBlockerInfo = {
  jobId: string;
  blockedByChainId: string;
  index: number;
  traceContext: string | null;
};

export type StateChain = StateChainInfo & { head: StateJobInfo; tail: StateJobInfo | undefined };
export type StateJob = StateJobInfo & { chain: StateChainInfo };
export type StateBlockedJob = StateJobBlockerInfo & { job: StateJobInfo };

export type StateCount = { count: number; hasMore: boolean };

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
   * Gets chains by their IDs, in input order, `undefined` for missing chains. Pass
   * `lock: "exclusive"` to acquire a write-intent lock on each chain's head row.
   */
  getChains: (
    params: { chainIds: TJobId[] } & LockTxContextParam<TTxContext>,
  ) => Promise<(StateChain | undefined)[]>;

  /**
   * Gets jobs by their IDs, with their chains, in input order, `undefined` for missing
   * jobs. Pass `lock: "exclusive"` to acquire a write-intent lock on each job **and its
   * chain's head row** — completing a job writes that head, so a caller holding this lock
   * must hold it too. Take the locks in a consistent id order.
   */
  getJobs: (
    params: { jobIds: TJobId[] } & LockTxContextParam<TTxContext>,
  ) => Promise<(StateJob | undefined)[]>;

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
  }) => Promise<(StateChain & { deduplicated: boolean })[]>;

  /**
   * Completes each `continueFromId` and inserts its chain successor, linking the two.
   * The returned `job` is the completed predecessor; `continuation` is its successor.
   */
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
  }) => Promise<(StateJob & { continuation: StateJobInfo })[]>;

  /**
   * Completes each job with its terminal output, ending its chain and setting the
   * chain's `completedAt`. Returns results in input order. `hasBlockedJobs` reports
   * whether any job depends on the chain, gating `unblockJobs`. Handing a chain on
   * is `continueJobs`, not this.
   *
   * The caller must already hold each chain's head row — take it with
   * `getJobs({ lock: "exclusive" })` earlier in the same transaction. An adapter may
   * report `hasBlockedJobs` from within its own statement, and under a snapshot isolation
   * level that reading is only current once the head is locked: otherwise a blocker
   * committed while this statement waits for the head is missed, and its job stays
   * blocked against a completed chain.
   */
  completeJobs: (
    params: {
      completedBy?: string | null;
      jobs: {
        jobId: TJobId;
        output: unknown;
      }[];
    } & WriteTxContextParam<TTxContext>,
  ) => Promise<(StateJob & { hasBlockedJobs: boolean })[]>;

  /** Returns jobs to pending, clearing any running attempt. Skips completed and missing ids. */
  rescheduleJobs: (
    params: {
      jobs: {
        jobId: TJobId;
        schedule?: ScheduleOptions;
        error?: string;
      }[];
    } & WriteTxContextParam<TTxContext>,
  ) => Promise<(StateJob | undefined)[]>;

  /**
   * Deletes all jobs in the given chains atomically. Fails with `blockerRefs` if any
   * chain is referenced as a blocker by a job outside the set.
   */
  deleteChains: (
    params: { chainIds: TJobId[] } & WriteTxContextParam<TTxContext>,
  ) => Promise<(StateChain | StateBlockedJob[] | undefined)[]>;

  /**
   * Atomically selects a pending job and starts an attempt, returning it with its
   * chain. Two parallel callers must never receive the same job — locked rows must
   * be skipped, not waited on. `hasBlockers` gates `getJobBlockers`.
   */
  startJobAttempt: (
    params: { typeNames: string[]; workerId: string } & WriteTxContextParam<TTxContext>,
  ) => Promise<(StateJob & { hasBlockers: boolean }) | undefined>;

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
    params: {
      typeNames: string[];
      ignoredJobIds?: TJobId[];
    } & WriteTxContextParam<TTxContext>,
  ) => Promise<StateJob | undefined>;

  /**
   * Adds blocker dependencies to jobs, in input order, with one `blockers` entry per
   * `blockedByChainIds` position. Throws `ChainNotFoundError` if any `blockedByChainIds`
   * entry does not name a chain head.
   */
  addJobsBlockers: (params: {
    txCtx: TTxContext;
    jobBlockers: {
      jobId: TJobId;
      blockedByChainIds: TJobId[];
      blockerTraceContexts?: (string | null)[];
    }[];
  }) => Promise<(StateJob & { blockers: StateChainInfo[] })[]>;

  /** Gets the blocker chains for a job. */
  getJobBlockers: (
    params: { jobId: TJobId } & ReadTxContextParam<TTxContext>,
  ) => Promise<StateChain[]>;

  /**
   * Unblocks jobs when a blocker chain completes, transitioning them from blocked to
   * pending. Gated on `completeJobs`' `hasBlockedJobs`.
   */
  unblockJobs: (
    params: { blockedByChainId: TJobId } & WriteTxContextParam<TTxContext>,
  ) => Promise<StateBlockedJob[]>;

  /** Returns distinct chain type names present in the data. */
  listChainTypeNames: (params: ReadTxContextParam<TTxContext>) => Promise<string[]>;

  /** Returns distinct job type names present in the data. */
  listJobTypeNames: (params: ReadTxContextParam<TTxContext>) => Promise<string[]>;

  /** Returns capped per-status counts for each requested chain type name, in input order. */
  countByChainTypeNames: (
    params: ReadTxContextParam<TTxContext> & { typeNames: string[] },
  ) => Promise<{ running: StateCount; completed: StateCount }[]>;

  /** Returns capped per-status counts for each requested job type name, in input order. */
  countByJobTypeNames: (
    params: ReadTxContextParam<TTxContext> & { typeNames: string[] },
  ) => Promise<{ pending: StateCount; running: StateCount; completed: StateCount }[]>;

  /** Lists chains with pagination, status-dependent ordering, and filtering. */
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
  ) => Promise<Page<StateChain>>;

  /** Lists jobs with pagination, status-dependent ordering, and filtering. */
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
        | { status: "completed"; orderBy: "createdAt" | "completedAt" }
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
