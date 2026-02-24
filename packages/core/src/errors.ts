import { type ScheduleOptions } from "./entities/schedule.js";

export class JobTakenByAnotherWorkerError extends Error {
  readonly jobId: string | undefined;
  readonly workerId: string | undefined;
  readonly leasedBy: string | null | undefined;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JobTakenByAnotherWorkerError";
    const causeObj = options?.cause as
      | { jobId?: string; workerId?: string; leasedBy?: string | null }
      | undefined;
    this.jobId = causeObj?.jobId;
    this.workerId = causeObj?.workerId;
    this.leasedBy = causeObj?.leasedBy;
  }
}

export class JobNotFoundError extends Error {
  readonly jobId: string | undefined;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JobNotFoundError";
    const causeObj = options?.cause as { jobId?: string } | undefined;
    this.jobId = causeObj?.jobId;
  }
}

export class JobAlreadyCompletedError extends Error {
  readonly jobId: string | undefined;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JobAlreadyCompletedError";
    const causeObj = options?.cause as { jobId?: string } | undefined;
    this.jobId = causeObj?.jobId;
  }
}

export class WaitChainTimeoutError extends Error {
  readonly chainId: string | undefined;
  readonly timeoutMs: number | undefined;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WaitChainTimeoutError";
    const causeObj = options?.cause as { chainId?: string; timeoutMs?: number } | undefined;
    this.chainId = causeObj?.chainId;
    this.timeoutMs = causeObj?.timeoutMs;
  }
}

export type BlockerReference = {
  chainId: string;
  referencedByJobId: string;
};

export class BlockerReferenceError extends Error {
  readonly references: readonly BlockerReference[];

  constructor(
    message: string,
    references: readonly BlockerReference[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "BlockerReferenceError";
    this.references = references;
  }
}

export class HookNotRegisteredError extends Error {
  readonly key: symbol;

  constructor(key: symbol) {
    super(`TransactionHooks hook not registered: ${String(key)}`);
    this.name = "HookNotRegisteredError";
    this.key = key;
  }
}

export class RescheduleJobError extends Error {
  public readonly schedule: ScheduleOptions;
  constructor(
    message: string,
    options: {
      schedule: ScheduleOptions;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "RescheduleJobError";
    this.schedule = options.schedule;
  }
}

export const rescheduleJob = (schedule: ScheduleOptions, cause?: unknown): never => {
  throw new RescheduleJobError(`Reschedule job`, {
    schedule,
    cause,
  });
};

export type JobTypeValidationErrorCode =
  | "not_entry_point"
  | "invalid_continuation"
  | "invalid_blockers"
  | "invalid_input"
  | "invalid_output";

export class JobTypeValidationError extends Error {
  readonly code: JobTypeValidationErrorCode;
  readonly typeName: string;
  readonly details: Record<string, unknown>;

  constructor(options: {
    code: JobTypeValidationErrorCode;
    message: string;
    typeName: string;
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = "JobTypeValidationError";
    this.code = options.code;
    this.typeName = options.typeName;
    this.details = options.details ?? {};
  }
}
