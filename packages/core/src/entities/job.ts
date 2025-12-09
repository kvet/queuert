import { StateJob } from "../state-adapter/state-adapter.js";

export type Job<TQueueName, TInput> = {
  id: string;
  chainId: string;
  originId: string | null;
  rootId: string;
  queueName: TQueueName;
  input: TInput;
  createdAt: Date;
  scheduledAt: Date;
  updatedAt: Date;
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
} & (
  | {
      status: "waiting";
    }
  | {
      status: "pending";
    }
  | {
      status: "running";
      lockedBy?: string;
      lockedUntil?: Date;
    }
  | {
      status: "completed";
      completedAt: Date;
    }
);

export type RunningJob<TJob extends Job<any, any>> = TJob & {
  status: "running";
};

export const mapStateJobToJob = (stateJob: StateJob): Job<any, any> => {
  return {
    id: stateJob.id,
    chainId: stateJob.chainId,
    originId: stateJob.originId,
    rootId: stateJob.rootId,
    queueName: stateJob.queueName,
    input: stateJob.input,
    createdAt: stateJob.createdAt,
    scheduledAt: stateJob.scheduledAt,
    updatedAt: stateJob.updatedAt,
    attempt: stateJob.attempt,
    lastAttemptAt: stateJob.lastAttemptAt,
    lastAttemptError: stateJob.lastAttemptError,
    ...(stateJob.status === "completed"
      ? {
          status: "completed",
          completedAt: stateJob.completedAt!,
        }
      : stateJob.status === "running"
        ? {
            status: "running",
            lockedBy: stateJob.lockedBy ?? undefined,
            lockedUntil: stateJob.lockedUntil ?? undefined,
          }
        : stateJob.status === "waiting"
          ? {
              status: "waiting",
            }
          : {
              status: "pending",
            }),
  };
};

export const enqueuedJobSymbol: unique symbol = Symbol("enqueuedJob");

export type EnqueuedJob<TQueueName, TInput> = Job<TQueueName, TInput> & {
  [enqueuedJobSymbol]: true;
};

export const isEnqueuedJob = (obj: unknown): obj is EnqueuedJob<any, any> => {
  return typeof obj === "object" && obj !== null && (obj as any)[enqueuedJobSymbol] === true;
};
