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

export class WaitForJobChainCompletionTimeoutError extends Error {
  readonly chainId: string | undefined;
  readonly timeoutMs: number | undefined;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WaitForJobChainCompletionTimeoutError";
    const causeObj = options?.cause as { chainId?: string; timeoutMs?: number } | undefined;
    this.chainId = causeObj?.chainId;
    this.timeoutMs = causeObj?.timeoutMs;
  }
}

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
