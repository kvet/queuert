import { StateJob } from "../state-adapter/state-adapter.js";

export type Job<TQueueName, TInput> = {
  id: string; // TODO
  queueName: TQueueName;
  input: TInput;
  createdAt: Date;
  scheduledAt: Date;
  updatedAt: Date;
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
    queueName: stateJob.queueName,
    input: stateJob.input,
    createdAt: stateJob.createdAt,
    scheduledAt: stateJob.scheduledAt,
    updatedAt: stateJob.updatedAt,
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
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as any)[enqueuedJobSymbol] === true
  );
};
