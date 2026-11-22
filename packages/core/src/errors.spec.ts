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
  toSingleChainError,
  toSingleJobError,
} from "./errors.ts";

describe("toSingleJobError", () => {
  it("maps JobsNotFoundError to JobNotFoundError", () => {
    const batchError = new JobsNotFoundError("batch", { jobIds: ["job-1"] });

    expect(toSingleJobError(batchError, "job-1")).toMatchObject({
      constructor: JobNotFoundError,
      message: "Job with id job-1 not found",
      jobId: "job-1",
      cause: batchError,
    });
  });

  it("maps JobsAlreadyCompletedError to JobAlreadyCompletedError", () => {
    const batchError = new JobsAlreadyCompletedError("batch", { jobIds: ["job-1"] });

    expect(toSingleJobError(batchError, "job-1")).toMatchObject({
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

    expect(toSingleJobError(batchError, "job-1")).toMatchObject({
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

    expect(toSingleJobError(batchError, "job-1")).toMatchObject({
      constructor: JobTypeMismatchError,
      message: 'Expected job job-1 to have type "order" but found "notification"',
      expectedTypeName: "order",
      actualTypeName: "notification",
      cause: batchError,
    });
  });

  it("returns any other error unchanged", () => {
    const error = new Error("boom");

    expect(toSingleJobError(error, "job-1")).toBe(error);
  });
});

describe("toSingleChainError", () => {
  it("maps ChainsTypeMismatchError to ChainTypeMismatchError", () => {
    const batchError = new ChainsTypeMismatchError("batch", {
      chainIds: ["chain-1"],
      expectedTypeNames: ["order"],
      actualTypeNames: ["notification"],
    });

    expect(toSingleChainError(batchError, "chain-1")).toMatchObject({
      constructor: ChainTypeMismatchError,
      message: 'Expected chain chain-1 to have type "order" but found "notification"',
      expectedTypeName: "order",
      actualTypeName: "notification",
      cause: batchError,
    });
  });

  it("returns any other error unchanged", () => {
    const error = new Error("boom");

    expect(toSingleChainError(error, "chain-1")).toBe(error);
  });
});
