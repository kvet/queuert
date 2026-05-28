import { type ScheduleOptions } from "./entities/schedule.js";

/** Thrown when a job ID fails the state adapter's `validateId` check. */
export class InvalidJobIdError extends Error {
  /** The ID that failed validation. */
  readonly id: string;
  /** Where the ID came from: `"generator"` if produced by the adapter's `generateId`, `"caller"` if supplied by the caller. */
  readonly source: "generator" | "caller";

  constructor(
    message: string,
    options: { id: string; source: "generator" | "caller"; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "InvalidJobIdError";
    this.id = options.id;
    this.source = options.source;
  }
}

/** Thrown when a job's lease is held by another worker. */
export class JobTakenByAnotherWorkerError extends Error {
  /** The job that was contested. */
  readonly jobId: string;
  /** The worker that attempted to acquire the job. */
  readonly workerId: string;
  /** The worker that currently holds the lease, or `null` if unknown. */
  readonly leasedBy: string | null;

  constructor(
    message: string,
    options: { jobId: string; workerId: string; leasedBy?: string | null; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobTakenByAnotherWorkerError";
    this.jobId = options.jobId;
    this.workerId = options.workerId;
    this.leasedBy = options.leasedBy ?? null;
  }
}

/** Thrown when a job does not exist. */
export class JobNotFoundError extends Error {
  /** The ID that was looked up. */
  readonly jobId: string;

  constructor(message: string, options: { jobId: string; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobNotFoundError";
    this.jobId = options.jobId;
  }
}

/** Thrown when a chain does not exist. */
export class ChainNotFoundError extends Error {
  /** The chain ID that was looked up. */
  readonly chainId: string;

  constructor(message: string, options: { chainId: string; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ChainNotFoundError";
    this.chainId = options.chainId;
  }
}

/** Thrown when attempting to complete an already-completed job. */
export class JobAlreadyCompletedError extends Error {
  /** The job that was already completed. */
  readonly jobId: string;

  constructor(message: string, options: { jobId: string; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobAlreadyCompletedError";
    this.jobId = options.jobId;
  }
}

/** Thrown when attempting to trigger a job that is not in a triggerable state (must be `ready` or `scheduled`). */
export class JobNotTriggerableError extends Error {
  /** The job that could not be triggered. */
  readonly jobId: string;
  /** The job's current status (must be `ready` or `scheduled` to trigger). */
  readonly status: string;

  constructor(message: string, options: { jobId: string; status: string; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobNotTriggerableError";
    this.jobId = options.jobId;
    this.status = options.status;
  }
}

/** Thrown when {@link Client.awaitChain | awaitChain} exceeds its timeout or is aborted. */
export class WaitChainTimeoutError extends Error {
  /** The chain that timed out. */
  readonly chainId: string;
  /** The timeout duration in milliseconds. */
  readonly timeoutMs: number;

  constructor(message: string, options: { chainId: string; timeoutMs: number; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "WaitChainTimeoutError";
    this.chainId = options.chainId;
    this.timeoutMs = options.timeoutMs;
  }
}

/** Thrown when a job or chain's actual type does not match the expected `typeName`. */
export class JobTypeMismatchError extends Error {
  /** The type name that was expected. */
  readonly expectedTypeName: string;
  /** The type name that was found. */
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
  /** The blocker references that prevented deletion. */
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
  /** The hook key that was not found. */
  readonly key: symbol;

  constructor(message: string, options: { key: symbol }) {
    super(message);
    this.name = "HookNotRegisteredError";
    this.key = options.key;
  }
}

/** Thrown (internally or via {@link rescheduleJob}) to reschedule a job for later processing. */
export class RescheduleJobError extends Error {
  readonly schedule: ScheduleOptions;
  constructor(
    message: string,
    options: {
      schedule: ScheduleOptions;
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
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
  /** The type names that appeared in more than one registry. */
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

/**
 * Thrown by a merged {@link JobTypes} when an operation references a type name
 * that no slice owns. Only raised when every slice in the merge was built with
 * {@link createJobTypes}; mixed merges that include a {@link defineJobTypes}
 * slice fall back to no-op validation for unknown types.
 */
export class UnknownJobTypeError extends Error {
  /** The type name that no slice claimed. */
  readonly typeName: string;
  /** Type names registered across the merged slices, for diagnosis. */
  readonly registeredTypeNames: readonly string[];

  constructor(
    message: string,
    options: { typeName: string; registeredTypeNames: readonly string[]; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "UnknownJobTypeError";
    this.typeName = options.typeName;
    this.registeredTypeNames = options.registeredTypeNames;
  }
}

/** Error codes for job type validation failures. */
export type JobTypeValidationErrorCode =
  | "not_entry_point"
  | "invalid_continuation"
  | "invalid_blockers"
  | "invalid_input"
  | "invalid_output";

/** Thrown when a mutating client method is called without a transaction context from `withTransaction`. */
export class TransactionContextRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionContextRequiredError";
  }
}

/** Thrown when runtime job type validation fails (via {@link createJobTypes}). */
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
