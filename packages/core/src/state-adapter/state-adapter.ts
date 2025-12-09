import { BaseStateProviderContext } from "../state-provider/state-provider.js";

export type StateJob = {
  id: string;
  queueName: string;
  input: unknown;
  output: unknown;

  rootId: string;
  chainId: string;
  originId: string | null;

  status: "created" | "waiting" | "pending" | "running" | "completed";
  createdAt: Date;
  scheduledAt: Date;
  completedAt: Date | null;

  attempt: number;
  lastAttemptError: string | null;
  lastAttemptAt: Date | null;

  lockedBy: string | null;
  lockedUntil: Date | null;

  updatedAt: Date;
};

export type StateAdapter = {
  getJobChainById: (params: {
    context: BaseStateProviderContext;
    jobId: string;
  }) => Promise<[StateJob, StateJob | undefined] | undefined>;
  getJobById: (params: {
    context: BaseStateProviderContext;
    jobId: string;
  }) => Promise<StateJob | undefined>;

  createJob: (params: {
    context: BaseStateProviderContext;
    queueName: string;
    input: unknown;
    rootId: string | undefined;
    chainId: string | undefined;
    originId: string | undefined;
  }) => Promise<StateJob>;

  addJobBlockers: (params: {
    context: BaseStateProviderContext;
    jobId: string;
    blockedByChainIds: string[];
  }) => Promise<[StateJob, StateJob | undefined][]>;
  scheduleBlockedJobs: (params: {
    context: BaseStateProviderContext;
    blockedByChainId: string;
  }) => Promise<StateJob[]>;
  getJobBlockers: (params: {
    context: BaseStateProviderContext;
    jobId: string;
  }) => Promise<[StateJob, StateJob | undefined][]>;

  getNextJobAvailableInMs: (params: {
    context: BaseStateProviderContext;
    queueNames: string[];
  }) => Promise<number | null>;
  acquireJob: (params: {
    context: BaseStateProviderContext;
    queueNames: string[];
  }) => Promise<StateJob | undefined>;
  markJobAsWaiting: (params: {
    context: BaseStateProviderContext;
    jobId: string;
  }) => Promise<StateJob>;
  markJobAsPending: (params: {
    context: BaseStateProviderContext;
    jobId: string;
  }) => Promise<StateJob>;
  startJobAttempt: (params: {
    context: BaseStateProviderContext;
    jobId: string;
  }) => Promise<StateJob>;
  renewJobLease: (params: {
    context: BaseStateProviderContext;
    jobId: string;
    workerId: string;
    lockDurationMs: number;
  }) => Promise<StateJob>;
  rescheduleJob: (params: {
    context: BaseStateProviderContext;
    jobId: string;
    afterMs: number;
    error: string;
  }) => Promise<StateJob>;
  completeJob: (params: {
    context: BaseStateProviderContext;
    jobId: string;
    output: unknown;
  }) => Promise<StateJob>;
  removeExpiredJobClaim: (params: {
    context: BaseStateProviderContext;
    queueNames: string[];
  }) => Promise<StateJob | undefined>;
};
