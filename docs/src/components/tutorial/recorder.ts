import type { ObservabilityAdapter } from "queuert";

import { formatLog } from "./runtime.ts";

/** One thing that happened to a chain or job during a run, in the order Queuert reported it. */
export type ChainEvent =
  | { kind: "chain-created"; chainId: string; typeName: string }
  | { kind: "chain-completed"; chainId: string; output: string }
  | {
      kind: "job-created";
      jobId: string;
      chainId: string;
      typeName: string;
      input: string;
      blocked: boolean;
    }
  | { kind: "job-blocked"; jobId: string }
  | { kind: "job-unblocked"; jobId: string }
  | { kind: "attempt-started"; jobId: string; attempt: number }
  | { kind: "attempt-failed"; jobId: string; attempt: number; error: string }
  | { kind: "job-rescheduled"; jobId: string; reason?: string }
  | { kind: "job-completed"; jobId: string; output: string | undefined; continuedWith?: string };

export type RecordedStatus = "blocked" | "pending" | "running" | "completed";

export type RecordedJob = {
  id: string;
  typeName: string;
  input: string;
  status: RecordedStatus;
  attempts: number;
  output?: string;
  error?: string;
};

export type RecordedChain = {
  id: string;
  typeName: string;
  status: "running" | "completed";
  output?: string;
  jobs: RecordedJob[];
};

const describe = (value: unknown) => formatLog([value]);

const ignore = () => undefined;

const adapterMemberFlags = {
  workerStarted: true,
  workerError: true,
  workerLeaseLost: true,
  workerStopped: true,
  chainCreated: true,
  chainCompleted: true,
  chainDeleted: true,
  jobCreated: true,
  jobCompleted: true,
  jobRescheduled: true,
  jobBlocked: true,
  jobUnblocked: true,
  jobAttemptStarted: true,
  jobAttemptLost: true,
  jobAttemptFailed: true,
  jobAttemptCompleted: true,
  jobAttemptReclaimed: true,
  notifyAdapterError: true,
  stateAdapterError: true,
  chainDuration: true,
  jobDuration: true,
  jobAttemptDuration: true,
  jobAttemptBatchSize: true,
  jobTypeIdleChange: true,
  jobTypeProcessingChange: true,
  startJobSpan: true,
  startBlockerSpan: true,
  completeBlockerSpan: true,
  startAttemptSpan: true,
} satisfies Record<keyof ObservabilityAdapter, true>;

const adapterMembers = Object.keys(adapterMemberFlags) as (keyof ObservabilityAdapter)[];

/**
 * Wraps `queuert` so every client a lesson creates reports to `onEvent` through an observability
 * adapter; a client given its own adapter keeps it and goes unrecorded.
 */
export const createChainRecorder = <TQueuert extends { createClient: (options: any) => any }>(
  queuert: TQueuert,
  onEvent: (event: ChainEvent) => void,
): TQueuert => {
  const recorded: Partial<ObservabilityAdapter> = {
    chainCreated: (data) => {
      onEvent({ kind: "chain-created", chainId: data.id, typeName: data.typeName });
    },
    chainCompleted: (data) => {
      onEvent({ kind: "chain-completed", chainId: data.id, output: describe(data.output) });
    },
    jobCreated: (data) => {
      onEvent({
        kind: "job-created",
        jobId: data.id,
        chainId: data.chainId,
        typeName: data.typeName,
        input: describe(data.input),
        blocked: data.blockers.length > 0,
      });
    },
    jobCompleted: (data) => {
      onEvent({
        kind: "job-completed",
        jobId: data.id,
        output: data.output == null ? undefined : describe(data.output),
        continuedWith: data.continuedWith?.id,
      });
    },
    jobRescheduled: (data) => {
      onEvent({ kind: "job-rescheduled", jobId: data.id, reason: data.reason });
    },
    jobBlocked: (data) => {
      onEvent({ kind: "job-blocked", jobId: data.id });
    },
    jobUnblocked: (data) => {
      onEvent({ kind: "job-unblocked", jobId: data.id });
    },
    jobAttemptStarted: (data) => {
      onEvent({ kind: "attempt-started", jobId: data.id, attempt: data.attempt });
    },
    jobAttemptFailed: (data) => {
      onEvent({
        kind: "attempt-failed",
        jobId: data.id,
        attempt: data.attempt,
        error: data.error instanceof Error ? data.error.message : describe(data.error),
      });
    },
  };
  const adapter = Object.fromEntries(
    adapterMembers.map((member) => [member, recorded[member] ?? ignore]),
  ) as ObservabilityAdapter;
  return {
    ...queuert,
    createClient: (options: { observabilityAdapter?: ObservabilityAdapter }) =>
      queuert.createClient({
        ...options,
        observabilityAdapter: options.observabilityAdapter ?? adapter,
      }),
  };
};

const joinsPrevious = (event: ChainEvent, previous: ChainEvent | undefined) => {
  if (previous === undefined) return false;
  if (event.kind === "job-created") {
    return (
      (previous.kind === "chain-created" && previous.chainId === event.chainId) ||
      (previous.kind === "job-completed" && previous.continuedWith === event.jobId) ||
      previous.kind === "job-created"
    );
  }
  if (event.kind === "chain-created") return previous.kind === "job-created";
  if (event.kind === "chain-completed") return previous.kind === "job-completed";
  if (event.kind === "job-completed") {
    return previous.kind === "job-created" && previous.jobId === event.continuedWith;
  }
  if (event.kind === "job-blocked") return previous.kind === "job-created";
  return false;
};

/**
 * Groups events into the steps a reader watches: a chain with its first job, a job completing
 * together with the job it continues with or the chain it completes, and each attempt start or
 * failure on its own.
 */
export const groupFrames = (events: ChainEvent[]): ChainEvent[][] => {
  const frames: ChainEvent[][] = [];
  events.forEach((event, index) => {
    if (frames.length > 0 && joinsPrevious(event, events[index - 1])) frames.at(-1)!.push(event);
    else frames.push([event]);
  });
  return frames;
};

/** The chains as they stood after `events`, in the order they were created. */
export const reduceChains = (events: ChainEvent[]): RecordedChain[] => {
  const chains = new Map<string, RecordedChain>();
  const jobs = new Map<string, RecordedJob>();
  const chainOf = (chainId: string) => {
    let chain = chains.get(chainId);
    if (chain === undefined) {
      chain = { id: chainId, typeName: "", status: "running", jobs: [] };
      chains.set(chainId, chain);
    }
    return chain;
  };
  for (const event of events) {
    switch (event.kind) {
      case "chain-created":
        chainOf(event.chainId).typeName = event.typeName;
        break;
      case "chain-completed": {
        const chain = chainOf(event.chainId);
        chain.status = "completed";
        chain.output = event.output;
        break;
      }
      case "job-created": {
        const job: RecordedJob = {
          id: event.jobId,
          typeName: event.typeName,
          input: event.input,
          status: event.blocked ? "blocked" : "pending",
          attempts: 0,
        };
        jobs.set(job.id, job);
        const chain = chainOf(event.chainId);
        if (chain.typeName === "") chain.typeName = event.typeName;
        chain.jobs.push(job);
        break;
      }
      case "job-blocked":
      case "job-unblocked": {
        const job = jobs.get(event.jobId);
        if (job === undefined) break;
        job.status = event.kind === "job-blocked" ? "blocked" : "pending";
        break;
      }
      case "attempt-started": {
        const job = jobs.get(event.jobId);
        if (job === undefined) break;
        job.status = "running";
        job.attempts = event.attempt;
        break;
      }
      case "attempt-failed": {
        const job = jobs.get(event.jobId);
        if (job === undefined) break;
        job.status = "pending";
        job.error = event.error;
        break;
      }
      case "job-rescheduled": {
        const job = jobs.get(event.jobId);
        if (job === undefined) break;
        job.status = "pending";
        break;
      }
      case "job-completed": {
        const job = jobs.get(event.jobId);
        if (job === undefined) break;
        job.status = "completed";
        job.output = event.output;
        break;
      }
    }
  }
  return [...chains.values()];
};
