import { BaseStateProviderContext } from "../state-provider/state-provider.js";

export type StateJob = {
  id: string;
  queueName: string;
  input: unknown;
  output: unknown;

  rootId: string;
  chainId: string;
  parentId: string | null;

  status: "created" | "waiting" | "pending" | "running" | "completed";
  createdAt: Date;
  scheduledAt: Date;
  completedAt: Date | null;

  attempt: number;
  lastAttemptError: unknown;
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
    parentId?: string;
  }) => Promise<StateJob>;

  addJobDependencies: (params: {
    context: BaseStateProviderContext;
    jobId: string;
    dependsOnChainIds: string[];
  }) => Promise<[StateJob, StateJob | undefined][]>;
  scheduleDependentJobs: (params: {
    context: BaseStateProviderContext;
    dependsOnChainId: string;
  }) => Promise<string[]>;
  getJobDependencies: (params: {
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
  markJob: (params: {
    context: BaseStateProviderContext;
    jobId: string;
    status: "pending" | "running" | "waiting";
  }) => Promise<StateJob>;
  sendHeartbeat: (params: {
    context: BaseStateProviderContext;
    jobId: string;
    workerId: string;
    lockDurationMs: number;
  }) => Promise<StateJob>;
  rescheduleJob: (params: {
    context: BaseStateProviderContext;
    jobId: string;
    afterMs: number;
    error: unknown;
  }) => Promise<StateJob>;
  linkJob: (params: {
    context: BaseStateProviderContext;
    jobId: string;
    chainId: string;
  }) => Promise<StateJob>;
  completeJob: (params: {
    context: BaseStateProviderContext;
    jobId: string;
    output: unknown;
  }) => Promise<StateJob>;
};
