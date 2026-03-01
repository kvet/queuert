import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type OrderDirection, type Page, type PageParams } from "../pagination.js";
import { type ScheduleOptions } from "../entities/schedule.js";

export type StateJobStatus = "blocked" | "pending" | "running" | "completed";

export type StateJob = {
  id: string;
  typeName: string;
  chainId: string;
  chainTypeName: string;
  chainIndex: number;
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

  chainTraceContext: unknown;
  traceContext: unknown;
};

/** Base type for state adapter contexts. */
export type BaseTxContext = {};

/**
 * Abstracts database operations for job persistence.
 *
 * Allows different database implementations (PostgreSQL, SQLite, in-memory).
 * Handles job creation, status transitions, leasing, and queries.
 *
 * All operation methods have an optional `txCtx` parameter:
 * - When txCtx is provided (from within `runInTransaction`), operations use that transaction
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
  runInTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;

  /** Gets a job chain by its chain ID. Returns [rootJob, lastJob] or undefined. */
  getJobChainById: (params: {
    txCtx?: TTxContext;
    chainId: TJobId;
  }) => Promise<[StateJob, StateJob | undefined] | undefined>;

  /** Gets a job by its ID. */
  getJobById: (params: { txCtx?: TTxContext; jobId: TJobId }) => Promise<StateJob | undefined>;

  /** Creates a new job. Returns the job and whether it was deduplicated. */
  createJob: (params: {
    txCtx?: TTxContext;
    typeName: string;
    chainId: TJobId | undefined;
    chainTypeName: string;
    chainIndex: number;
    input: unknown;
    deduplication?: DeduplicationOptions;
    schedule?: ScheduleOptions;
    chainTraceContext?: unknown;
    traceContext?: unknown;
  }) => Promise<{ job: StateJob; deduplicated: boolean }>;

  /** Adds blocker dependencies to a job. Returns `blockerChainTraceContexts` in the same order as `blockedByChainIds`. */
  addJobBlockers: (params: {
    txCtx?: TTxContext;
    jobId: TJobId;
    blockedByChainIds: TJobId[];
    blockerTraceContexts?: unknown[];
  }) => Promise<{
    job: StateJob;
    incompleteBlockerChainIds: string[];
    blockerChainTraceContexts: unknown[];
  }>;

  /** Unblocks jobs when a blocker chain completes, transitioning them from blocked to pending. */
  unblockJobs: (params: {
    txCtx?: TTxContext;
    blockedByChainId: TJobId;
  }) => Promise<{ unblockedJobs: StateJob[]; blockerTraceContexts: unknown[] }>;

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

  /** Acquires a pending job for processing. Returns the job and whether more jobs are waiting. */
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

  /** Removes an expired lease and resets the job to pending. */
  reapExpiredJobLease: (params: {
    txCtx?: TTxContext;
    typeNames: string[];
    ignoredJobIds?: TJobId[];
  }) => Promise<StateJob | undefined>;

  /** Deletes all jobs in the given chains. Throws if external jobs depend on them as blockers. When `cascade` is true, expands `chainIds` to include transitive dependencies (downward only) before deleting. */
  deleteJobChains: (params: {
    txCtx?: TTxContext;
    chainIds: TJobId[];
    cascade?: boolean;
  }) => Promise<[StateJob, StateJob | undefined][]>;

  /** Gets a job by ID with a FOR UPDATE lock. */
  getJobForUpdate: (params: { txCtx?: TTxContext; jobId: TJobId }) => Promise<StateJob | undefined>;

  /** Gets the latest job in a chain with a FOR UPDATE lock. */
  getLatestChainJobForUpdate: (params: {
    txCtx?: TTxContext;
    chainId: TJobId;
  }) => Promise<StateJob | undefined>;

  /** Lists chains with pagination and filtering. */
  listJobChains: (params: {
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
      chainId?: string[];
      jobId?: string[];
      from?: Date;
      to?: Date;
    };
    orderDirection: OrderDirection;
    page: PageParams;
  }) => Promise<Page<StateJob>>;

  /** Lists jobs within a specific chain, ordered by chain index. */
  listJobChainJobs: (params: {
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
};

export type GetStateAdapterTxContext<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer TTxContext, infer _TJobId> ? TTxContext : never;

export type GetStateAdapterJobId<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer _TTxContext, infer TJobId> ? TJobId : never;
