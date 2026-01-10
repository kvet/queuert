import { DeduplicationOptions, DeduplicationStrategy } from "../entities/deduplication.js";
import { ScheduleOptions } from "../entities/schedule.js";

export type { DeduplicationOptions, DeduplicationStrategy, ScheduleOptions };

export type StateJob = {
  id: string;
  typeName: string;
  sequenceId: string;
  sequenceTypeName: string;
  input: unknown;
  output: unknown;

  rootSequenceId: string;
  originId: string | null;

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

  updatedAt: Date;
};

/** Base type for state adapter contexts. */
export type BaseStateAdapterContext = {};

/**
 * Abstracts database operations for job persistence.
 *
 * Allows different database implementations (PostgreSQL, SQLite, MongoDB, in-memory).
 * Handles job creation, status transitions, leasing, and queries.
 *
 * @typeParam TContext - The context type containing database client/transaction info
 * @typeParam TJobId - The job ID type used for input parameters
 */
export type StateAdapter<
  TTxContext extends BaseStateAdapterContext,
  TContext extends BaseStateAdapterContext,
  TJobId extends string,
> = {
  /** Provides a database context for operations. */
  provideContext: <T>(fn: (context: TContext) => Promise<T>) => Promise<T>;

  /** Executes a callback within a database transaction. */
  runInTransaction: <T>(context: TContext, fn: (txContext: TTxContext) => Promise<T>) => Promise<T>;

  /** Checks if the given context is within a transaction. */
  isInTransaction: (context: TTxContext) => Promise<boolean>;

  /** Gets a job sequence by its root job ID. Returns [rootJob, lastJob] or undefined. */
  getJobSequenceById: (params: {
    context: TTxContext;
    jobId: TJobId;
  }) => Promise<[StateJob, StateJob | undefined] | undefined>;

  /** Gets a job by its ID. */
  getJobById: (params: { context: TTxContext; jobId: TJobId }) => Promise<StateJob | undefined>;

  /** Creates a new job. Returns the job and whether it was deduplicated. */
  createJob: (params: {
    context: TTxContext;
    typeName: string;
    sequenceId: TJobId | undefined;
    sequenceTypeName: string;
    input: unknown;
    rootSequenceId: TJobId | undefined;
    originId: TJobId | undefined;
    deduplication?: DeduplicationOptions;
    schedule?: ScheduleOptions;
  }) => Promise<{ job: StateJob; deduplicated: boolean }>;

  /** Adds blocker dependencies to a job. */
  addJobBlockers: (params: {
    context: TTxContext;
    jobId: TJobId;
    blockedBySequenceIds: TJobId[];
  }) => Promise<{ job: StateJob; incompleteBlockerSequenceIds: string[] }>;

  /** Schedules blocked jobs when a blocker sequence completes. */
  scheduleBlockedJobs: (params: {
    context: TTxContext;
    blockedBySequenceId: TJobId;
  }) => Promise<StateJob[]>;

  /** Gets the blocker sequences for a job. */
  getJobBlockers: (params: {
    context: TTxContext;
    jobId: TJobId;
  }) => Promise<[StateJob, StateJob | undefined][]>;

  /** Gets the time in ms until the next job is available, or null if none. */
  getNextJobAvailableInMs: (params: {
    context: TTxContext;
    typeNames: string[];
  }) => Promise<number | null>;

  /** Acquires a pending job for processing. */
  acquireJob: (params: {
    context: TTxContext;
    typeNames: string[];
  }) => Promise<StateJob | undefined>;

  /** Renews the lease on a running job. */
  renewJobLease: (params: {
    context: TTxContext;
    jobId: TJobId;
    workerId: string;
    leaseDurationMs: number;
  }) => Promise<StateJob>;

  /** Reschedules a job for later processing. */
  rescheduleJob: (params: {
    context: TTxContext;
    jobId: TJobId;
    schedule: ScheduleOptions;
    error: string;
  }) => Promise<StateJob>;

  /** Completes a job with the given output. */
  completeJob: (params: {
    context: TTxContext;
    jobId: TJobId;
    output: unknown;
    workerId: string | null;
  }) => Promise<StateJob>;

  /** Removes an expired lease and resets the job to pending. */
  removeExpiredJobLease: (params: {
    context: TTxContext;
    typeNames: string[];
  }) => Promise<StateJob | undefined>;

  /** Gets external blockers that depend on the given root sequences. */
  getExternalBlockers: (params: {
    context: TTxContext;
    rootSequenceIds: TJobId[];
  }) => Promise<{ jobId: TJobId; blockedRootSequenceId: TJobId }[]>;

  /** Deletes all jobs in the given root sequences. */
  deleteJobsByRootSequenceIds: (params: {
    context: TTxContext;
    rootSequenceIds: TJobId[];
  }) => Promise<StateJob[]>;

  /** Gets a job by ID with a FOR UPDATE lock. */
  getJobForUpdate: (params: {
    context: TTxContext;
    jobId: TJobId;
  }) => Promise<StateJob | undefined>;

  /** Gets the current (latest) job in a sequence with a FOR UPDATE lock. */
  getCurrentJobForUpdate: (params: {
    context: TTxContext;
    sequenceId: TJobId;
  }) => Promise<StateJob | undefined>;
};

export type GetStateAdapterTxContext<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer TTxContext, infer _TContext, infer _TJobId>
    ? TTxContext
    : never;

export type GetStateAdapterContext<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer _TTxContext, infer TContext, infer _TJobId>
    ? TContext
    : never;

export type GetStateAdapterJobId<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer _TContext, infer _TContext, infer TJobId>
    ? TJobId
    : never;
