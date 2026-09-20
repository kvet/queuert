import { describe, expect, expectTypeOf, it } from "vitest";

import { type StateJobInfo } from "../state-adapter/state-adapter.js";
import { type AnyJob, mapStateJobToJob } from "./job.js";

const chainInfo = {
  id: "chain-1",
  typeName: "test",
  status: "running" as const,
  deduplicationKey: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  completedAt: null,
  traceContext: null,
};

const pendingJobInfo: StateJobInfo = {
  id: "job-1",
  chainId: "chain-1",
  typeName: "test",
  chainIndex: 0,
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
  status: "pending",
  traceContext: null,
};

const pendingStateJob = { ...pendingJobInfo, chain: chainInfo };

const runningStateJob = {
  ...pendingStateJob,
  status: "running" as const,
  attempt: 1,
  attemptAt: new Date("2026-01-01T00:00:30Z"),
  attemptBy: "worker-1",
};

describe("mapStateJobToJob", () => {
  it("maps the stored status through, blocked included", () => {
    expect(mapStateJobToJob(pendingStateJob).status).toBe("pending");
    expect(mapStateJobToJob({ ...pendingStateJob, status: "blocked" }).status).toBe("blocked");
    expect(
      mapStateJobToJob({
        ...pendingStateJob,
        status: "completed",
        completedAt: new Date("2026-01-01T00:01:00Z"),
      }).status,
    ).toBe("completed");
  });

  it("carries the chain position through", () => {
    expect(mapStateJobToJob(pendingStateJob).chainIndex).toBe(0);
    expect(mapStateJobToJob({ ...pendingStateJob, chainIndex: 3 }).chainIndex).toBe(3);
  });

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
