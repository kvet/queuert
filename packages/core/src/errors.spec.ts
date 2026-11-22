import { describe, expect, it } from "vitest";

import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobStatusMismatchError,
  JobTypeMismatchError,
  JobsAlreadyCompletedError,
  JobsNotFoundError,
  JobsStatusMismatchError,
  JobsTypeMismatchError,
  ChainTypeMismatchError,
  ChainsTypeMismatchError,
  JobBlockerLimitExceededError,
  ChainNotFoundError,
  ChainsNotFoundError,
  InvalidJobIdError,
  InvalidJobIdsError,
  JobTypeValidationError,
  JobsBlockerLimitExceededError,
  JobsTypeValidationError,
  UnknownJobTypeError,
  UnknownJobTypesError,
  WaitChainTimeoutError,
  WaitChainsTimeoutError,
  toSingleChainError,
  toSingleJobError,
} from "./errors.ts";

describe("toSingleJobError", () => {
  it("maps JobsNotFoundError to JobNotFoundError", () => {
    const batchError = new JobsNotFoundError("batch", { jobIds: ["job-1"] });

    expect(toSingleJobError(batchError)).toMatchObject({
      constructor: JobNotFoundError,
      message: "Job with id job-1 not found",
      jobId: "job-1",
      cause: batchError,
    });
  });

  it("maps JobsAlreadyCompletedError to JobAlreadyCompletedError", () => {
    const batchError = new JobsAlreadyCompletedError("batch", { jobIds: ["job-1"] });

    expect(toSingleJobError(batchError)).toMatchObject({
      constructor: JobAlreadyCompletedError,
      message: "Cannot apply an outcome to job job-1: job is already completed",
      jobId: "job-1",
      cause: batchError,
    });
  });

  it("maps JobsStatusMismatchError to JobStatusMismatchError", () => {
    const batchError = new JobsStatusMismatchError("batch", {
      jobIds: ["job-1"],
      expectedStatuses: ["pending"],
      actualStatuses: ["running"],
    });

    expect(toSingleJobError(batchError)).toMatchObject({
      constructor: JobStatusMismatchError,
      message: 'Expected job job-1 to have status "pending" but found "running"',
      jobId: "job-1",
      expectedStatus: "pending",
      actualStatus: "running",
      cause: batchError,
    });
  });

  it("maps JobsTypeMismatchError to JobTypeMismatchError", () => {
    const batchError = new JobsTypeMismatchError("batch", {
      jobIds: ["job-1"],
      expectedTypeNames: ["order"],
      actualTypeNames: ["notification"],
    });

    expect(toSingleJobError(batchError)).toMatchObject({
      constructor: JobTypeMismatchError,
      message: 'Expected job job-1 to have type "order" but found "notification"',
      expectedTypeName: "order",
      actualTypeName: "notification",
      cause: batchError,
    });
  });

  it("maps each item batch error to its first item's error", () => {
    const invalidJobIdError = new InvalidJobIdError("invalid id", {
      id: "bad-id",
      source: "caller",
    });
    const blockerLimitError = new JobBlockerLimitExceededError("too many blockers", {
      typeName: "ship-order",
      count: 12,
      limit: 10,
    });
    const validationError = new JobTypeValidationError("invalid input", {
      code: "invalid_input",
      typeName: "ship-order",
    });
    const unknownTypeError = new UnknownJobTypeError("unknown type", {
      typeName: "missing",
      registeredTypeNames: ["ship-order"],
    });

    expect(
      toSingleJobError(
        new InvalidJobIdsError("batch", { itemIndexes: [2], errors: [invalidJobIdError] }),
      ),
    ).toBe(invalidJobIdError);
    expect(
      toSingleJobError(
        new JobsBlockerLimitExceededError("batch", {
          itemIndexes: [0],
          errors: [blockerLimitError],
        }),
      ),
    ).toBe(blockerLimitError);
    expect(
      toSingleJobError(
        new JobsTypeValidationError("batch", { itemIndexes: [0], errors: [validationError] }),
      ),
    ).toBe(validationError);
    expect(
      toSingleJobError(
        new UnknownJobTypesError("batch", { itemIndexes: [1], errors: [unknownTypeError] }),
      ),
    ).toBe(unknownTypeError);
  });

  it("returns any other error unchanged", () => {
    const error = new Error("boom");

    expect(toSingleJobError(error)).toBe(error);
  });
});

describe("toSingleChainError", () => {
  it("maps ChainsTypeMismatchError to ChainTypeMismatchError", () => {
    const batchError = new ChainsTypeMismatchError("batch", {
      chainIds: ["chain-1"],
      expectedTypeNames: ["order"],
      actualTypeNames: ["notification"],
    });

    expect(toSingleChainError(batchError)).toMatchObject({
      constructor: ChainTypeMismatchError,
      message: 'Expected chain chain-1 to have type "order" but found "notification"',
      expectedTypeName: "order",
      actualTypeName: "notification",
      cause: batchError,
    });
  });

  it("maps ChainsNotFoundError to ChainNotFoundError", () => {
    const batchError = new ChainsNotFoundError("batch", { chainIds: ["chain-1"] });

    expect(toSingleChainError(batchError)).toMatchObject({
      constructor: ChainNotFoundError,
      message: "Chain with id chain-1 not found",
      chainId: "chain-1",
      cause: batchError,
    });
  });

  it("maps WaitChainsTimeoutError to WaitChainTimeoutError on timeout and on abort", () => {
    const timeoutError = new WaitChainsTimeoutError("batch", {
      chainIds: ["chain-1"],
      timeoutMs: 100,
    });
    expect(toSingleChainError(timeoutError)).toMatchObject({
      constructor: WaitChainTimeoutError,
      message: "Timeout waiting for chain chain-1 to complete after 100ms",
      chainId: "chain-1",
      timeoutMs: 100,
    });
    expect(toSingleChainError(timeoutError)).not.toHaveProperty("cause");

    const abortReason = new Error("request closed");
    expect(
      toSingleChainError(
        new WaitChainsTimeoutError("batch", {
          chainIds: ["chain-1"],
          timeoutMs: 100,
          cause: abortReason,
        }),
      ),
    ).toMatchObject({
      constructor: WaitChainTimeoutError,
      message: "Wait for chain chain-1 was aborted",
      cause: abortReason,
    });
  });

  it("returns any other error unchanged", () => {
    const error = new Error("boom");

    expect(toSingleChainError(error)).toBe(error);
  });
});
