import { DbJob } from "../sql.js";

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

export const mapDbJobToJob = (dbJob: DbJob): Job<any, any> => {
  return {
    id: dbJob.id,
    queueName: dbJob.queue_name, // TODO
    input: dbJob.input,
    createdAt: new Date(dbJob.created_at),
    scheduledAt: new Date(dbJob.scheduled_at),
    updatedAt: new Date(dbJob.updated_at),
    ...(dbJob.status === "completed"
      ? {
          status: "completed",
          completedAt: new Date(dbJob.completed_at!),
        }
      : dbJob.status === "running"
      ? {
          status: "running",
          lockedBy: dbJob.locked_by ?? undefined,
          lockedUntil: dbJob.locked_until
            ? new Date(dbJob.locked_until)
            : undefined,
        }
      : dbJob.status === "waiting"
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
