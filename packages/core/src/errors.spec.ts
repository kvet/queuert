import { describe, expect, it } from "vitest";

import {
  JobTypeMismatchError,
  JobsTypeMismatchError,
  ChainTypeMismatchError,
  ChainsTypeMismatchError,
  toSingleChainError,
  toSingleJobError,
} from "./errors.ts";

describe("toSingleJobError", () => {
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
