import { DeduplicationOptions, DeduplicationStrategy } from "../entities/job-sequence.js";
import { BaseStateProviderContext } from "../state-provider/state-provider.js";

export type { DeduplicationOptions, DeduplicationStrategy };

export type StateJob = {
  id: string;
  typeName: string;
  input: unknown;
  output: unknown;

  rootId: string;
  sequenceId: string;
  originId: string | null;

  status: "created" | "blocked" | "pending" | "running" | "completed";
  createdAt: Date;
  scheduledAt: Date;
  completedAt: Date | null;

  attempt: number;
  lastAttemptError: string | null;
  lastAttemptAt: Date | null;

  leasedBy: string | null;
  leasedUntil: Date | null;

  deduplicationKey: string | null;

  updatedAt: Date;
};

export type StateAdapter<TContext extends BaseStateProviderContext = BaseStateProviderContext> = {
  provideContext: <T>(fn: (context: TContext) => Promise<T>) => Promise<T>;
  runInTransaction: <T>(context: TContext, fn: (txContext: TContext) => Promise<T>) => Promise<T>;
  assertInTransaction: (context: TContext) => Promise<void>;

  prepareSchema: (context: TContext) => Promise<void>;
  migrateToLatest: (context: TContext) => Promise<void>;

  getJobSequenceById: (params: {
    context: TContext;
    jobId: string;
  }) => Promise<[StateJob, StateJob | undefined] | undefined>;
  getJobById: (params: { context: TContext; jobId: string }) => Promise<StateJob | undefined>;

  createJob: (params: {
    context: TContext;
    typeName: string;
    input: unknown;
    rootId: string | undefined;
    sequenceId: string | undefined;
    originId: string | undefined;
    deduplication?: DeduplicationOptions;
  }) => Promise<{ job: StateJob; deduplicated: boolean }>;

  addJobBlockers: (params: {
    context: TContext;
    jobId: string;
    blockedBySequenceIds: string[];
  }) => Promise<[StateJob, StateJob | undefined][]>;
  scheduleBlockedJobs: (params: {
    context: TContext;
    blockedBySequenceId: string;
  }) => Promise<StateJob[]>;
  getJobBlockers: (params: {
    context: TContext;
    jobId: string;
  }) => Promise<[StateJob, StateJob | undefined][]>;

  getNextJobAvailableInMs: (params: {
    context: TContext;
    typeNames: string[];
  }) => Promise<number | null>;
  acquireJob: (params: { context: TContext; typeNames: string[] }) => Promise<StateJob | undefined>;
  markJobAsBlocked: (params: { context: TContext; jobId: string }) => Promise<StateJob>;
  markJobAsPending: (params: { context: TContext; jobId: string }) => Promise<StateJob>;
  startJobAttempt: (params: { context: TContext; jobId: string }) => Promise<StateJob>;
  renewJobLease: (params: {
    context: TContext;
    jobId: string;
    workerId: string;
    leaseDurationMs: number;
  }) => Promise<StateJob>;
  rescheduleJob: (params: {
    context: TContext;
    jobId: string;
    afterMs: number;
    error: string;
  }) => Promise<StateJob>;
  completeJob: (params: { context: TContext; jobId: string; output: unknown }) => Promise<StateJob>;
  removeExpiredJobLease: (params: {
    context: TContext;
    typeNames: string[];
  }) => Promise<StateJob | undefined>;
};

export type GetStateAdapterContext<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer TContext> ? TContext : never;
