import { describe, expect, it } from "vitest";

import { decodeWorkerId, isLeaseLost, summarizeWorkers } from "./workers.js";

describe("isLeaseLost", () => {
  it("is false while the lease ends in the future", () => {
    expect(
      isLeaseLost(
        { leaseUntil: new Date("2026-01-01T00:00:01Z") },
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).toBe(false);
  });

  it("is true once the lease ends", () => {
    expect(
      isLeaseLost(
        { leaseUntil: new Date("2026-01-01T00:00:00Z") },
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).toBe(true);
    expect(
      isLeaseLost(
        { leaseUntil: new Date("2026-01-01T00:00:00Z") },
        new Date("2026-01-01T00:00:01Z"),
      ),
    ).toBe(true);
  });
});

describe("summarizeWorkers", () => {
  it("sums running and idle slots and counts lost leases", () => {
    expect(
      summarizeWorkers(
        [
          { runningJobCount: 2, concurrency: 4, leaseUntil: new Date("2026-01-01T00:01:00Z") },
          { runningJobCount: 1, concurrency: 1, leaseUntil: new Date("2026-01-01T00:00:00Z") },
          { runningJobCount: 0, concurrency: 5, leaseUntil: new Date("2026-01-01T00:02:00Z") },
        ],
        new Date("2026-01-01T00:00:30Z"),
      ),
    ).toEqual({ count: 3, runningSlots: 3, idleSlots: 7, leaseLostCount: 1 });
  });

  it("is all zeros for no workers", () => {
    expect(summarizeWorkers([], new Date("2026-01-01T00:00:00Z"))).toEqual({
      count: 0,
      runningSlots: 0,
      idleSlots: 0,
      leaseLostCount: 0,
    });
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
