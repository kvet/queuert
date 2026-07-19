import { describe, expect, expectTypeOf, it } from "vitest";

import { type StateJob } from "../state-adapter/state-adapter.js";
import { type AnyJob, deriveStatus, mapStateJobToJob } from "./job.js";

const pendingStateJob = {
  id: "job-1",
  chainId: "chain-1",
  typeName: "test",
  chainTypeName: "test",
  input: { value: 1 },
  output: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  scheduledAt: new Date("2026-01-01T00:00:00Z"),
  attempt: 0,
  lastAttemptAt: null,
  lastAttemptError: null,
  attemptAt: null,
  attemptBy: null,
  attemptUntil: null,
  completedAt: null,
  completedBy: null,
  continuedToId: null,
  blocked: false,
  deduplicationKey: null,
  chainTraceContext: null,
  traceContext: null,
} satisfies StateJob;

const runningStateJob: StateJob = {
  ...pendingStateJob,
  attempt: 1,
  attemptAt: new Date("2026-01-01T00:00:30Z"),
  attemptBy: "worker-1",
};

describe("deriveStatus", () => {
  it("derives running from attemptAt", () => {
    expect(deriveStatus(runningStateJob)).toBe("running");
    expect(deriveStatus(pendingStateJob)).toBe("pending");
    expect(
      deriveStatus({ ...pendingStateJob, completedAt: new Date("2026-01-01T00:01:00Z") }),
    ).toBe("completed");
  });
});

describe("mapStateJobToJob", () => {
  it("carries the attempt triplet through on a running job", () => {
    const job = mapStateJobToJob(runningStateJob);

    expect(job.status).toBe("running");
    if (job.status !== "running") throw new Error("expected a running job");
    expect(job.attemptAt).toEqual(runningStateJob.attemptAt);
    expect(job.attemptBy).toBe("worker-1");
    expect(job.attemptUntil).toBeNull();
  });

  it("types attemptAt/attemptBy as non-null and attemptUntil as nullable", () => {
    const job = {} as Extract<AnyJob, { status: "running" }>;

    expectTypeOf(job.attemptAt).toEqualTypeOf<Date>();
    expectTypeOf(job.attemptBy).toEqualTypeOf<string>();
    expectTypeOf(job.attemptUntil).toEqualTypeOf<Date | null>();
  });
});
