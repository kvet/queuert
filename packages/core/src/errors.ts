import { type ScheduleOptions } from "./entities/schedule.js";

/** Thrown when a job's lease is held by another worker. */
export class JobTakenByAnotherWorkerError extends Error {
  readonly jobId: string | undefined;
  readonly workerId: string | undefined;
  readonly leasedBy: string | null | undefined;

  constructor(
    message: string,
    options?: { jobId?: string; workerId?: string; leasedBy?: string | null; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobTakenByAnotherWorkerError";
    this.jobId = options?.jobId;
    this.workerId = options?.workerId;
    this.leasedBy = options?.leasedBy;
  }
}

/** Thrown when a job does not exist. */
export class JobNotFoundError extends Error {
  readonly jobId: string | undefined;

  constructor(message: string, options?: { jobId?: string; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobNotFoundError";
    this.jobId = options?.jobId;
  }
}

/** Thrown when a job chain does not exist. */
export class JobChainNotFoundError extends Error {
  readonly chainId: string | undefined;

  constructor(message: string, options?: { chainId?: string; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobChainNotFoundError";
    this.chainId = options?.chainId;
  }
}

/** Thrown when attempting to complete an already-completed job. */
export class JobAlreadyCompletedError extends Error {
  readonly jobId: string | undefined;

  constructor(message: string, options?: { jobId?: string; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobAlreadyCompletedError";
    this.jobId = options?.jobId;
  }
}

/** Thrown when {@link Client.awaitJobChain | awaitJobChain} exceeds its timeout or is aborted. */
export class WaitChainTimeoutError extends Error {
  readonly chainId: string | undefined;
  readonly timeoutMs: number | undefined;

  constructor(
    message: string,
    options?: { chainId?: string; timeoutMs?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "WaitChainTimeoutError";
    this.chainId = options?.chainId;
    this.timeoutMs = options?.timeoutMs;
  }
}

/** Thrown when a job or chain's actual type does not match the expected `typeName`. */
export class JobTypeMismatchError extends Error {
  readonly expectedTypeName: string;
  readonly actualTypeName: string;

  constructor(
    message: string,
    options: { expectedTypeName: string; actualTypeName: string; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobTypeMismatchError";
    this.expectedTypeName = options.expectedTypeName;
    this.actualTypeName = options.actualTypeName;
  }
}

/** Describes a single blocker reference: which chain is referenced by which job. */
export type BlockerReference = {
  chainId: string;
  referencedByJobId: string;
};

/** Thrown when deleting chains that are still referenced as blockers by other jobs. */
export class BlockerReferenceError extends Error {
  readonly references: readonly BlockerReference[];

  constructor(
    message: string,
    options: { references: readonly BlockerReference[]; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "BlockerReferenceError";
    this.references = options.references;
  }
}

/** Thrown when accessing a transaction hook that has not been registered. */
export class HookNotRegisteredError extends Error {
  readonly key: symbol;

  constructor(message: string, options: { key: symbol }) {
    super(message);
    this.name = "HookNotRegisteredError";
    this.key = options.key;
  }
}

/** Thrown (internally or via {@link rescheduleJob}) to reschedule a job for later processing. */
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

/**
 * Throw a {@link RescheduleJobError} to reschedule the current job.
 *
 * @param schedule - When to retry (absolute date or relative delay).
 * @param cause - Optional underlying error.
 */
export const rescheduleJob = (schedule: ScheduleOptions, cause?: unknown): never => {
  throw new RescheduleJobError(`Reschedule job`, {
    schedule,
    cause,
  });
};

/** Thrown when merging registries that contain overlapping job type names. */
export class DuplicateJobTypeError extends Error {
  readonly duplicateTypeNames: readonly string[];

  constructor(
    message: string,
    options: { duplicateTypeNames: readonly string[]; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "DuplicateJobTypeError";
    this.duplicateTypeNames = options.duplicateTypeNames;
  }
}

/** Error codes for job type validation failures. */
export type JobTypeValidationErrorCode =
  | "not_entry_point"
  | "invalid_continuation"
  | "invalid_blockers"
  | "invalid_input"
  | "invalid_output";

/** Thrown when runtime job type validation fails (via {@link createJobTypeRegistry}). */
export class JobTypeValidationError extends Error {
  /** The specific validation failure code. */
  readonly code: JobTypeValidationErrorCode;
  /** The job type name that failed validation. */
  readonly typeName: string;
  /** Additional context about the failure. */
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      code: JobTypeValidationErrorCode;
      typeName: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobTypeValidationError";
    this.code = options.code;
    this.typeName = options.typeName;
    this.details = options.details ?? {};
  }
}
