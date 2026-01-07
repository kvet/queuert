import { DeduplicationOptions, DeduplicationStrategy } from "../entities/deduplication.js";
import { ScheduleOptions } from "../entities/schedule.js";

export type { DeduplicationOptions, DeduplicationStrategy, ScheduleOptions };

export type StateJob = {
  id: string;
  typeName: string;
  input: unknown;
  output: unknown;

  rootId: string;
  sequenceId: string;
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

export type BaseStateAdapterContext = {};

export type StateAdapter<TContext extends BaseStateAdapterContext, TJobId> = {
  provideContext: <T>(fn: (context: TContext) => Promise<T>) => Promise<T>;
  runInTransaction: <T>(context: TContext, fn: (txContext: TContext) => Promise<T>) => Promise<T>;
  isInTransaction: (context: TContext) => Promise<boolean>;

  getJobSequenceById: (params: {
    context: TContext;
    jobId: TJobId;
  }) => Promise<[StateJob, StateJob | undefined] | undefined>;
  getJobById: (params: { context: TContext; jobId: TJobId }) => Promise<StateJob | undefined>;

  createJob: (params: {
    context: TContext;
    typeName: string;
    input: unknown;
    rootId: TJobId | undefined;
    sequenceId: TJobId | undefined;
    originId: TJobId | undefined;
    deduplication?: DeduplicationOptions;
    schedule?: ScheduleOptions;
  }) => Promise<{ job: StateJob; deduplicated: boolean }>;

  addJobBlockers: (params: {
    context: TContext;
    jobId: TJobId;
    blockedBySequenceIds: TJobId[];
  }) => Promise<{ job: StateJob; incompleteBlockerSequenceIds: string[] }>;
  scheduleBlockedJobs: (params: {
    context: TContext;
    blockedBySequenceId: TJobId;
  }) => Promise<StateJob[]>;
  getJobBlockers: (params: {
    context: TContext;
    jobId: TJobId;
  }) => Promise<[StateJob, StateJob | undefined][]>;

  getNextJobAvailableInMs: (params: {
    context: TContext;
    typeNames: string[];
  }) => Promise<number | null>;
  acquireJob: (params: { context: TContext; typeNames: string[] }) => Promise<StateJob | undefined>;
  renewJobLease: (params: {
    context: TContext;
    jobId: TJobId;
    workerId: string;
    leaseDurationMs: number;
  }) => Promise<StateJob>;
  rescheduleJob: (params: {
    context: TContext;
    jobId: TJobId;
    schedule: ScheduleOptions;
    error: string;
  }) => Promise<StateJob>;
  completeJob: (params: {
    context: TContext;
    jobId: TJobId;
    output: unknown;
    workerId: string | null;
  }) => Promise<StateJob>;
  removeExpiredJobLease: (params: {
    context: TContext;
    typeNames: string[];
  }) => Promise<StateJob | undefined>;
  getExternalBlockers: (params: {
    context: TContext;
    rootIds: TJobId[];
  }) => Promise<{ jobId: TJobId; blockedRootId: TJobId }[]>;
  deleteJobsByRootIds: (params: { context: TContext; rootIds: TJobId[] }) => Promise<StateJob[]>;
  getJobForUpdate: (params: { context: TContext; jobId: TJobId }) => Promise<StateJob | undefined>;
  getCurrentJobForUpdate: (params: {
    context: TContext;
    sequenceId: TJobId;
  }) => Promise<StateJob | undefined>;
};

export type GetStateAdapterContext<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer TContext, infer _TJobId> ? TContext : never;

export type GetStateAdapterJobId<TStateAdapter> =
  TStateAdapter extends StateAdapter<infer _TContext, infer TJobId> ? TJobId : never;
