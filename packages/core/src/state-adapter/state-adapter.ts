import { type DeduplicationOptions, type DeduplicationScope } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";

export type { DeduplicationOptions, DeduplicationScope, ScheduleOptions };

export type StateJob = {
  id: string;
  typeName: string;
  chainId: string;
  chainTypeName: string;
  input: unknown;
  output: unknown;

  status: "blocked" | "pending" | "running" | "completed";
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
 * All operation methods have an optional `txContext` parameter:
 * - When txContext is provided (from within `runInTransaction`), operations use that transaction
 * - When txContext is omitted, the adapter acquires its own connection, executes, and releases
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
  runInTransaction: <T>(fn: (txContext: TTxContext) => Promise<T>) => Promise<T>;

  /** Gets a job chain by its root job ID. Returns [rootJob, lastJob] or undefined. */
  getJobChainById: (params: {
    txContext?: TTxContext;
    jobId: TJobId;
  }) => Promise<[StateJob, StateJob | undefined] | undefined>;

  /** Gets a job by its ID. */
  getJobById: (params: { txContext?: TTxContext; jobId: TJobId }) => Promise<StateJob | undefined>;

  /** Creates a new job. Returns the job and whether it was deduplicated. */
  createJob: (params: {
    txContext?: TTxContext;
    typeName: string;
    chainId: TJobId | undefined;
    chainTypeName: string;
    input: unknown;
    deduplication?: DeduplicationOptions;
    schedule?: ScheduleOptions;
    traceContext?: unknown;
  }) => Promise<{ job: StateJob; deduplicated: boolean }>;

  /** Adds blocker dependencies to a job. Returns `blockerChainTraceContexts` in the same order as `blockedByChainIds`. */
  addJobBlockers: (params: {
    txContext?: TTxContext;
    jobId: TJobId;
    blockedByChainIds: TJobId[];
    blockerTraceContexts?: unknown[];
  }) => Promise<{
    job: StateJob;
    incompleteBlockerChainIds: string[];
    blockerChainTraceContexts: unknown[];
  }>;

  /** Schedules blocked jobs when a blocker chain completes. */
  scheduleBlockedJobs: (params: {
    txContext?: TTxContext;
    blockedByChainId: TJobId;
  }) => Promise<{ unblockedJobs: StateJob[]; blockerTraceContexts: unknown[] }>;

  /** Gets the blocker chains for a job. */
  getJobBlockers: (params: {
    txContext?: TTxContext;
    jobId: TJobId;
  }) => Promise<[StateJob, StateJob | undefined][]>;

  /** Gets the time in ms until the next job is available, or null if none. */
  getNextJobAvailableInMs: (params: {
    txContext?: TTxContext;
    typeNames: string[];
  }) => Promise<number | null>;

  /** Acquires a pending job for processing. Returns the job and whether more jobs are waiting. */
  acquireJob: (params: {
    txContext?: TTxContext;
    typeNames: string[];
  }) => Promise<{ job: StateJob | undefined; hasMore: boolean }>;

  /** Renews the lease on a running job. */
  renewJobLease: (params: {
    txContext?: TTxContext;
    jobId: TJobId;
    workerId: string;
    leaseDurationMs: number;
  }) => Promise<StateJob>;

  /** Reschedules a job for later processing. */
  rescheduleJob: (params: {
    txContext?: TTxContext;
    jobId: TJobId;
    schedule: ScheduleOptions;
    error: string;
  }) => Promise<StateJob>;

  /** Completes a job with the given output. */
  completeJob: (params: {
    txContext?: TTxContext;
    jobId: TJobId;
    output: unknown;
    workerId: string | null;
  }) => Promise<StateJob>;

  /** Removes an expired lease and resets the job to pending. */
  removeExpiredJobLease: (params: {
    txContext?: TTxContext;
    typeNames: string[];
    ignoredJobIds?: TJobId[];
  }) => Promise<StateJob | undefined>;

  /** Deletes all jobs in the given chains. Throws if external jobs depend on them as blockers. */
  deleteJobsByChainIds: (params: {
    txContext?: TTxContext;
    chainIds: TJobId[];
  }) => Promise<[StateJob, StateJob | undefined][]>;

  /** Gets a job by ID with a FOR UPDATE lock. */
  getJobForUpdate: (params: {
    txContext?: TTxContext;
    jobId: TJobId;
  }) => Promise<StateJob | undefined>;

  /** Gets the current (latest) job in a chain with a FOR UPDATE lock. */
  getCurrentJobForUpdate: (params: {
    txContext?: TTxContext;
    chainId: TJobId;
  }) => Promise<StateJob | undefined>;
};

export type GetStateAdapterTxContext<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer TTxContext, infer _TJobId> ? TTxContext : never;

export type GetStateAdapterJobId<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer _TTxContext, infer TJobId> ? TJobId : never;
