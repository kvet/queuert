import { StateJob } from "../state-adapter/state-adapter.js";

export type Job<TJobTypeName, TInput> = {
  id: string;
  sequenceId: string;
  originId: string | null;
  rootId: string;
  typeName: TJobTypeName;
  input: TInput;
  createdAt: Date;
  scheduledAt: Date;
  updatedAt: Date;
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
} & (
  | {
      status: "created";
    }
  | {
      status: "blocked";
    }
  | {
      status: "pending";
    }
  | {
      status: "running";
      leasedBy?: string;
      leasedUntil?: Date;
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
  const base = {
    id: stateJob.id,
    sequenceId: stateJob.sequenceId,
    originId: stateJob.originId,
    rootId: stateJob.rootId,
    typeName: stateJob.typeName,
    input: stateJob.input,
    createdAt: stateJob.createdAt,
    scheduledAt: stateJob.scheduledAt,
    updatedAt: stateJob.updatedAt,
    attempt: stateJob.attempt,
    lastAttemptAt: stateJob.lastAttemptAt,
    lastAttemptError: stateJob.lastAttemptError,
  };

  switch (stateJob.status) {
    case "completed":
      return {
        ...base,
        status: "completed",
        completedAt: stateJob.completedAt!,
      };
    case "running":
      return {
        ...base,
        status: "running",
        leasedBy: stateJob.leasedBy ?? undefined,
        leasedUntil: stateJob.leasedUntil ?? undefined,
      };
    case "blocked":
      return { ...base, status: "blocked" };
    default:
      return { ...base, status: "pending" };
  }
};

export const continuedJobSymbol: unique symbol = Symbol("continuedJob");

export type ContinuedJob<TJobTypeName, TInput> = Job<TJobTypeName, TInput> & {
  [continuedJobSymbol]: true;
};

export const isContinuedJob = (obj: unknown): obj is ContinuedJob<any, any> => {
  return typeof obj === "object" && obj !== null && (obj as any)[continuedJobSymbol] === true;
};
