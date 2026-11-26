import type { JobStatus } from "./entities/job.types.ts";

/** Thrown when a job ID fails the state adapter's `validateJobId` check. */
export class InvalidJobIdError extends Error {
  /** The ID that failed validation. */
  readonly id: string;
  /**
   * Where the ID came from: `"generator"` if produced by the adapter's
   * `generateJobId`, `"caller"` if supplied by the caller.
   */
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

/**
 * Thrown when {@link Client.createChains | createChains} or
 * {@link Client.applyJobOutcomes | applyJobOutcomes} resolves job IDs that fail the state adapter's
 * `validateJobId` check. Batch variant of {@link InvalidJobIdError}, listing every offending item.
 * When items fail with different kinds of errors, it lists the items that failed with the
 * first kind.
 */
export class InvalidJobIdsError extends Error {
  /** The position of each offending item in the `items` the call was passed. */
  readonly itemIndexes: readonly number[];
  /** The error of each item in `itemIndexes`, in the same order. */
  readonly errors: readonly InvalidJobIdError[];

  constructor(
    message: string,
    options: {
      itemIndexes: readonly number[];
      errors: readonly InvalidJobIdError[];
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "InvalidJobIdsError";
    this.itemIndexes = options.itemIndexes;
    this.errors = options.errors;
  }
}

/** Thrown when a worker ID fails the state adapter's `validateWorkerId` check. */
export class InvalidWorkerIdError extends Error {
  /** The ID that failed validation. */
  readonly id: string;

  constructor(message: string, options: { id: string; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "InvalidWorkerIdError";
    this.id = options.id;
  }
}

/** Thrown when the job's current attempt is not the one this worker holds. */
export class JobTakenByAnotherWorkerError extends Error {
  /** The job that was contested. */
  readonly jobId: string;
  /** The worker that attempted to acquire the job. */
  readonly workerId: string;
  /** The worker that currently holds the attempt, or `null` if unknown. */
  readonly attemptBy: string | null;

  constructor(
    message: string,
    options: { jobId: string; workerId: string; attemptBy?: string | null; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobTakenByAnotherWorkerError";
    this.jobId = options.jobId;
    this.workerId = options.workerId;
    this.attemptBy = options.attemptBy ?? null;
  }
}

/**
 * Thrown when a batched attempt handler's `applyJobOutcomes` or `fenceJobs` finds jobs it names
 * whose current attempt is not the one this worker holds. Batch variant of
 * {@link JobTakenByAnotherWorkerError}, listing every such job.
 */
export class JobsTakenByAnotherWorkerError extends Error {
  /** The jobs that were contested. */
  readonly jobIds: readonly string[];
  /** The worker that holds the batch. */
  readonly workerId: string;
  /**
   * The worker that currently holds the attempt of each job in `jobIds`, in the same order, or
   * `null` if unknown.
   */
  readonly attemptBys: readonly (string | null)[];

  constructor(
    message: string,
    options: {
      jobIds: readonly string[];
      workerId: string;
      attemptBys: readonly (string | null)[];
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobsTakenByAnotherWorkerError";
    this.jobIds = options.jobIds;
    this.workerId = options.workerId;
    this.attemptBys = options.attemptBys;
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

/**
 * Thrown when {@link Client.applyJobOutcomes | applyJobOutcomes} targets any job that does not exist.
 * Batch variant of {@link JobNotFoundError}, listing every input id with no matching job.
 */
export class JobsNotFoundError extends Error {
  /** The input ids that had no matching job. */
  readonly jobIds: readonly string[];

  constructor(message: string, options: { jobIds: readonly string[]; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobsNotFoundError";
    this.jobIds = options.jobIds;
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

/**
 * Thrown when {@link Client.awaitChains | awaitChains} waits on chains that do not exist, or when a
 * batch call declares blocker chains that do not exist. Batch variant of {@link ChainNotFoundError},
 * listing every missing chain id.
 */
export class ChainsNotFoundError extends Error {
  /** The chain ids that had no matching chain. */
  readonly chainIds: readonly string[];

  constructor(message: string, options: { chainIds: readonly string[]; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ChainsNotFoundError";
    this.chainIds = options.chainIds;
  }
}

/**
 * Recorded as a job's `lastAttemptError` when a worker reclaims its attempt because the worker
 * holding the attempt lost its lease, stopped, or no longer runs it.
 */
export class JobAttemptReclaimedError extends Error {
  /** The worker that reclaimed the attempt. */
  readonly reclaimedBy: string;

  constructor(message: string, options: { reclaimedBy: string; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobAttemptReclaimedError";
    this.reclaimedBy = options.reclaimedBy;
  }
}

/**
 * Thrown when a worker can't start because a live worker holds its id. Reported through
 * `workerError`.
 */
export class WorkerAlreadyLiveError extends Error {
  /** The worker id held by the live worker. */
  readonly workerId: string;

  constructor(message: string, options: { workerId: string; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "WorkerAlreadyLiveError";
    this.workerId = options.workerId;
  }
}

/** Thrown when a worker lost its lease. Reported through `workerError`. */
export class WorkerLeaseLostError extends Error {
  /** The worker that lost its lease. */
  readonly workerId: string;

  constructor(message: string, options: { workerId: string; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "WorkerLeaseLostError";
    this.workerId = options.workerId;
  }
}

/**
 * Thrown when a write is fenced: a breaking migration dropped the write fence of this code
 * version, so older code can no longer change jobs, blockers or workers. The write changes nothing.
 * Worker runners report it through `workerError` and keep retrying. On Redis it is also thrown
 * until `migrateToLatest()` has run.
 */
export class SchemaFencedError extends Error {
  /** The schema version of the code whose write was fenced. */
  readonly codeVersion: number;

  constructor(message: string, options: { codeVersion: number; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "SchemaFencedError";
    this.codeVersion = options.codeVersion;
  }
}

/** Thrown when completing, continuing or rescheduling a job that is already completed. */
export class JobAlreadyCompletedError extends Error {
  /** The job that was already completed. */
  readonly jobId: string;

  constructor(message: string, options: { jobId: string; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobAlreadyCompletedError";
    this.jobId = options.jobId;
  }
}

/**
 * Thrown when {@link Client.applyJobOutcomes | applyJobOutcomes} targets any job that is already completed.
 * Batch variant of {@link JobAlreadyCompletedError}, listing every offending input id.
 */
export class JobsAlreadyCompletedError extends Error {
  /** The input ids whose job is already completed. */
  readonly jobIds: readonly string[];

  constructor(message: string, options: { jobIds: readonly string[]; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobsAlreadyCompletedError";
    this.jobIds = options.jobIds;
  }
}

/**
 * Thrown when {@link Client.awaitChain | awaitChain} exceeds its timeout or is aborted. When aborted,
 * `cause` is the signal's reason.
 */
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

/**
 * Thrown when {@link Client.awaitChains | awaitChains} exceeds its timeout or is aborted before every
 * chain completed. Batch variant of {@link WaitChainTimeoutError}, listing every chain still running.
 * When aborted, `cause` is the signal's reason.
 */
export class WaitChainsTimeoutError extends Error {
  /** The chains that had not completed. */
  readonly chainIds: readonly string[];
  /** The timeout duration in milliseconds. */
  readonly timeoutMs: number;

  constructor(
    message: string,
    options: { chainIds: readonly string[]; timeoutMs: number; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "WaitChainsTimeoutError";
    this.chainIds = options.chainIds;
    this.timeoutMs = options.timeoutMs;
  }
}

/**
 * Thrown when {@link Client.applyJobOutcome | applyJobOutcome} is passed a job read earlier whose
 * `status` no longer matches the stored job: it changed since the read.
 */
export class JobStatusMismatchError extends Error {
  /** The job whose status changed. */
  readonly jobId: string;
  /** The status of the job that was passed. */
  readonly expectedStatus: JobStatus;
  /** The status of the stored job. */
  readonly actualStatus: JobStatus;

  constructor(
    message: string,
    options: { jobId: string; expectedStatus: JobStatus; actualStatus: JobStatus; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobStatusMismatchError";
    this.jobId = options.jobId;
    this.expectedStatus = options.expectedStatus;
    this.actualStatus = options.actualStatus;
  }
}

/**
 * Thrown when {@link Client.applyJobOutcomes | applyJobOutcomes} is passed any job read earlier
 * whose `status` no longer matches the stored job. Batch variant of {@link JobStatusMismatchError},
 * listing every offending input id.
 */
export class JobsStatusMismatchError extends Error {
  /** The input ids whose status changed. */
  readonly jobIds: readonly string[];
  /** The status passed for each job in `jobIds`, in the same order. */
  readonly expectedStatuses: readonly JobStatus[];
  /** The stored status of each job in `jobIds`, in the same order. */
  readonly actualStatuses: readonly JobStatus[];

  constructor(
    message: string,
    options: {
      jobIds: readonly string[];
      expectedStatuses: readonly JobStatus[];
      actualStatuses: readonly JobStatus[];
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobsStatusMismatchError";
    this.jobIds = options.jobIds;
    this.expectedStatuses = options.expectedStatuses;
    this.actualStatuses = options.actualStatuses;
  }
}

/** Thrown when a job's actual type does not match the expected `typeName`. */
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

/**
 * Thrown when {@link Client.applyJobOutcomes | applyJobOutcomes} is passed any job whose
 * `typeName` differs from the stored job's, or when {@link Client.getJobs | getJobs} narrows by a
 * `typeName` that any found job does not have. Batch variant of {@link JobTypeMismatchError}, listing
 * every offending input id.
 */
export class JobsTypeMismatchError extends Error {
  /** The input ids whose type differs. */
  readonly jobIds: readonly string[];
  /** The type name passed for each job in `jobIds`, in the same order. */
  readonly expectedTypeNames: readonly string[];
  /** The stored type name of each job in `jobIds`, in the same order. */
  readonly actualTypeNames: readonly string[];

  constructor(
    message: string,
    options: {
      jobIds: readonly string[];
      expectedTypeNames: readonly string[];
      actualTypeNames: readonly string[];
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobsTypeMismatchError";
    this.jobIds = options.jobIds;
    this.expectedTypeNames = options.expectedTypeNames;
    this.actualTypeNames = options.actualTypeNames;
  }
}

/** Thrown when a chain's actual type does not match the expected `typeName`. */
export class ChainTypeMismatchError extends Error {
  /** The type name that was expected. */
  readonly expectedTypeName: string;
  /** The type name that was found. */
  readonly actualTypeName: string;

  constructor(
    message: string,
    options: { expectedTypeName: string; actualTypeName: string; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ChainTypeMismatchError";
    this.expectedTypeName = options.expectedTypeName;
    this.actualTypeName = options.actualTypeName;
  }
}

/**
 * Thrown when {@link Client.getChains | getChains} or
 * {@link Client.getChainTailJobs | getChainTailJobs} narrows by a `typeName` that any found chain
 * does not have, or when {@link Client.awaitChains | awaitChains},
 * {@link Client.createChains | createChains} or {@link Client.applyJobOutcomes | applyJobOutcomes}
 * is passed a chain or blocker whose `typeName` differs from the stored chain's. Batch variant of
 * {@link ChainTypeMismatchError}, listing every offending chain id.
 */
export class ChainsTypeMismatchError extends Error {
  /** The input ids whose chain type differs. */
  readonly chainIds: readonly string[];
  /** The type name expected for each chain in `chainIds`, in the same order. */
  readonly expectedTypeNames: readonly string[];
  /** The stored type name of each chain in `chainIds`, in the same order. */
  readonly actualTypeNames: readonly string[];

  constructor(
    message: string,
    options: {
      chainIds: readonly string[];
      expectedTypeNames: readonly string[];
      actualTypeNames: readonly string[];
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ChainsTypeMismatchError";
    this.chainIds = options.chainIds;
    this.expectedTypeNames = options.expectedTypeNames;
    this.actualTypeNames = options.actualTypeNames;
  }
}

/** Thrown when deleting chains that jobs still wait on as blockers, even jobs in chains deleted by the same call. */
export class BlockerReferenceError extends Error {
  /** The chains that blocked the deletion: each has `blocking: true`, so at least one job waits on it. */
  readonly chainIds: readonly string[];

  constructor(message: string, options: { chainIds: readonly string[]; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "BlockerReferenceError";
    this.chainIds = options.chainIds;
  }
}

/**
 * Thrown when a job declares more blocker chains than the state adapter's
 * `maxBlockersPerJob` allows. The limit is configurable but always bounded: the
 * `job_blocker` model is not designed to scale to an unbounded number of blockers per job.
 */
export class JobBlockerLimitExceededError extends Error {
  /** The job type that declared too many blockers. */
  readonly typeName: string;
  /** The number of blocker chains the job declared. */
  readonly count: number;
  /** The maximum number of blocker chains allowed per job. */
  readonly limit: number;

  constructor(
    message: string,
    options: { typeName: string; count: number; limit: number; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobBlockerLimitExceededError";
    this.typeName = options.typeName;
    this.count = options.count;
    this.limit = options.limit;
  }
}

/**
 * Thrown when {@link Client.createChains | createChains} or
 * {@link Client.applyJobOutcomes | applyJobOutcomes} declares more blocker chains for any job than
 * the state adapter's `maxBlockersPerJob` allows. Batch variant of
 * {@link JobBlockerLimitExceededError}, listing every offending item.
 * When items fail with different kinds of errors, it lists the items that failed with the
 * first kind.
 */
export class JobsBlockerLimitExceededError extends Error {
  /** The position of each offending item in the `items` the call was passed. */
  readonly itemIndexes: readonly number[];
  /** The error of each item in `itemIndexes`, in the same order. */
  readonly errors: readonly JobBlockerLimitExceededError[];

  constructor(
    message: string,
    options: {
      itemIndexes: readonly number[];
      errors: readonly JobBlockerLimitExceededError[];
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobsBlockerLimitExceededError";
    this.itemIndexes = options.itemIndexes;
    this.errors = options.errors;
  }
}

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

/**
 * Thrown when {@link Client.createChains | createChains} or
 * {@link Client.applyJobOutcomes | applyJobOutcomes} references type names that no slice of a
 * merged {@link JobTypes} owns. Batch variant of {@link UnknownJobTypeError}, listing every
 * offending item.
 * When items fail with different kinds of errors, it lists the items that failed with the
 * first kind.
 */
export class UnknownJobTypesError extends Error {
  /** The position of each offending item in the `items` the call was passed. */
  readonly itemIndexes: readonly number[];
  /** The error of each item in `itemIndexes`, in the same order. */
  readonly errors: readonly UnknownJobTypeError[];

  constructor(
    message: string,
    options: {
      itemIndexes: readonly number[];
      errors: readonly UnknownJobTypeError[];
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "UnknownJobTypesError";
    this.itemIndexes = options.itemIndexes;
    this.errors = options.errors;
  }
}

/** Error codes for job type validation failures. */
export type JobTypeValidationErrorCode =
  | "not_entry_point"
  | "invalid_continuation"
  | "invalid_blockers"
  | "invalid_input"
  | "invalid_output";

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

/**
 * Thrown when {@link Client.createChains | createChains} or
 * {@link Client.applyJobOutcomes | applyJobOutcomes} fails runtime job type validation for any item.
 * Batch variant of {@link JobTypeValidationError}, listing every offending item.
 * When items fail with different kinds of errors, it lists the items that failed with the
 * first kind.
 */
export class JobsTypeValidationError extends Error {
  /** The position of each offending item in the `items` the call was passed. */
  readonly itemIndexes: readonly number[];
  /** The error of each item in `itemIndexes`, in the same order. */
  readonly errors: readonly JobTypeValidationError[];

  constructor(
    message: string,
    options: {
      itemIndexes: readonly number[];
      errors: readonly JobTypeValidationError[];
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JobsTypeValidationError";
    this.itemIndexes = options.itemIndexes;
    this.errors = options.errors;
  }
}

export const toSingleJobError = (error: unknown): unknown => {
  if (error instanceof JobsTakenByAnotherWorkerError) {
    return new JobTakenByAnotherWorkerError(`Job taken by another worker`, {
      jobId: error.jobIds[0],
      workerId: error.workerId,
      attemptBy: error.attemptBys[0],
      cause: error,
    });
  }
  if (error instanceof JobsNotFoundError) {
    const jobId = error.jobIds[0];
    return new JobNotFoundError(`Job with id ${jobId} not found`, { jobId, cause: error });
  }
  if (error instanceof JobsAlreadyCompletedError) {
    const jobId = error.jobIds[0];
    return new JobAlreadyCompletedError(
      `Cannot apply an outcome to job ${jobId}: job is already completed`,
      { jobId, cause: error },
    );
  }
  if (error instanceof JobsStatusMismatchError) {
    const jobId = error.jobIds[0];
    return new JobStatusMismatchError(
      `Expected job ${jobId} to have status "${error.expectedStatuses[0]}" but found "${error.actualStatuses[0]}"`,
      {
        jobId,
        expectedStatus: error.expectedStatuses[0],
        actualStatus: error.actualStatuses[0],
        cause: error,
      },
    );
  }
  if (error instanceof JobsTypeMismatchError) {
    return new JobTypeMismatchError(
      `Expected job ${error.jobIds[0]} to have type "${error.expectedTypeNames[0]}" but found "${error.actualTypeNames[0]}"`,
      {
        expectedTypeName: error.expectedTypeNames[0],
        actualTypeName: error.actualTypeNames[0],
        cause: error,
      },
    );
  }
  if (
    error instanceof InvalidJobIdsError ||
    error instanceof JobsBlockerLimitExceededError ||
    error instanceof JobsTypeValidationError ||
    error instanceof UnknownJobTypesError
  ) {
    return error.errors[0];
  }
  return error;
};

export const toSingleChainError = (error: unknown): unknown => {
  if (error instanceof ChainsNotFoundError) {
    const chainId = error.chainIds[0];
    return new ChainNotFoundError(`Chain with id ${chainId} not found`, { chainId, cause: error });
  }
  if (error instanceof ChainsTypeMismatchError) {
    return new ChainTypeMismatchError(
      `Expected chain ${error.chainIds[0]} to have type "${error.expectedTypeNames[0]}" but found "${error.actualTypeNames[0]}"`,
      {
        expectedTypeName: error.expectedTypeNames[0],
        actualTypeName: error.actualTypeNames[0],
        cause: error,
      },
    );
  }
  if (error instanceof WaitChainsTimeoutError) {
    const chainId = error.chainIds[0];
    return new WaitChainTimeoutError(
      error.cause !== undefined
        ? `Wait for chain ${chainId} was aborted`
        : `Timeout waiting for chain ${chainId} to complete after ${error.timeoutMs}ms`,
      { chainId, timeoutMs: error.timeoutMs, cause: error.cause },
    );
  }
  return error;
};
