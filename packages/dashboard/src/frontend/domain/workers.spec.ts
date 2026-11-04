import { describe, expect, it } from "vitest";

import { decodeWorkerId, isStrandedType, jobLease } from "./workers.js";

describe("jobLease", () => {
  it("is live while the worker has not lost its lease", () => {
    expect(jobLease({ leaseUntil: new Date("2026-01-01T00:00:01Z"), expired: false })).toEqual({
      state: "live",
      leaseUntil: new Date("2026-01-01T00:00:01Z"),
    });
  });

  it("is expired once the worker lost its lease", () => {
    expect(jobLease({ leaseUntil: new Date("2026-01-01T00:00:00Z"), expired: true })).toEqual({
      state: "expired",
    });
  });

  it("is gone when the worker has no row", () => {
    expect(jobLease(null)).toEqual({ state: "gone" });
  });
});

describe("isStrandedType", () => {
  it("flags a type with pending jobs and no live worker as stranded", () => {
    expect(isStrandedType({ pending: { count: 3, hasMore: false }, liveWorkerCount: 0 })).toBe(
      true,
    );
    expect(isStrandedType({ pending: { count: 3, hasMore: false }, liveWorkerCount: 1 })).toBe(
      false,
    );
    expect(isStrandedType({ pending: { count: 0, hasMore: false }, liveWorkerCount: 0 })).toBe(
      false,
    );
  });
});

describe("decodeWorkerId", () => {
  it("decodes an encoded segment", () => {
    expect(decodeWorkerId("a%2Fb%25c")).toBe("a/b%c");
  });

  it("returns a malformed segment unchanged", () => {
    expect(decodeWorkerId("%E0")).toBe("%E0");
  });
});
