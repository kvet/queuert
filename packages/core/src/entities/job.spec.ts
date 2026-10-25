import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { type ResolvedJobTypeValue, createNoopJobTypes } from "../job-types/job-types.js";
import { type StateJobInfo } from "../state-adapter/state-adapter.js";
import { type AnyJob, mapStateJobsToJobs } from "./job.js";

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
  attemptUntil: new Date("2026-01-01T00:01:30Z"),
};

const mapOne = async (stateJob: Parameters<typeof mapStateJobsToJobs>[0][number]) =>
  (await mapStateJobsToJobs([stateJob], createNoopJobTypes()))[0];

describe("mapStateJobsToJobs", () => {
  it("maps the stored status through, blocked included", async () => {
    expect((await mapOne(pendingStateJob)).status).toBe("pending");
    expect((await mapOne({ ...pendingStateJob, status: "blocked" })).status).toBe("blocked");
    expect(
      (
        await mapOne({
          ...pendingStateJob,
          status: "completed",
          completedAt: new Date("2026-01-01T00:01:00Z"),
        })
      ).status,
    ).toBe("completed");
  });

  it("carries the chain position through", async () => {
    expect((await mapOne(pendingStateJob)).chainIndex).toBe(0);
    expect((await mapOne({ ...pendingStateJob, chainIndex: 3 })).chainIndex).toBe(3);
  });

  it("decodes a page and its continuations in one call, outputs only for terminal jobs", async () => {
    const decode = vi.fn(async (items: readonly ResolvedJobTypeValue[]) =>
      items.map((item) => ({ decoded: item.value })),
    );
    const continuedJob = {
      ...pendingStateJob,
      status: "completed" as const,
      completedAt: new Date("2026-01-01T00:01:00Z"),
      continuedToId: "job-2",
      output: "ignored",
    };
    const continuation: StateJobInfo = {
      ...pendingJobInfo,
      id: "job-2",
      chainIndex: 1,
      input: { value: 2 },
      status: "completed",
      completedAt: new Date("2026-01-01T00:02:00Z"),
      output: { result: 2 },
    };

    const [first, second] = await mapStateJobsToJobs(
      [{ ...continuedJob, continuation }, runningStateJob],
      { decode },
    );

    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode.mock.calls[0][0].map((item) => item.direction)).toEqual([
      "input",
      "input",
      "output",
      "input",
    ]);
    expect(first.input).toEqual({ decoded: { value: 1 } });
    expect("output" in first).toBe(false);
    expect(first.continuedTo).toMatchObject({
      input: { decoded: { value: 2 } },
      output: { decoded: { result: 2 } },
    });
    expect(second.input).toEqual({ decoded: { value: 1 } });
  });

  it("carries the attempt triplet through on a running job", async () => {
    const job = await mapOne(runningStateJob);

    expect(job.status).toBe("running");
    if (job.status !== "running") throw new Error("expected a running job");
    expect(job.attemptAt).toEqual(runningStateJob.attemptAt);
    expect(job.attemptBy).toBe("worker-1");
    expect(job.attemptUntil).toEqual(runningStateJob.attemptUntil);
  });

  it("types the attempt triplet as non-null", () => {
    const job = {} as Extract<AnyJob, { status: "running" }>;

    expectTypeOf(job.attemptAt).toEqualTypeOf<Date>();
    expectTypeOf(job.attemptBy).toEqualTypeOf<string>();
    expectTypeOf(job.attemptUntil).toEqualTypeOf<Date>();
  });
});
