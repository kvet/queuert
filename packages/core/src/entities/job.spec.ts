import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { JobTypeMismatchError } from "../errors.ts";
import { createNoopJobTypes } from "../job-types/job-types.ts";
import type { StateJobInfo } from "../state-adapter/state-adapter.ts";
import { type Job, assertJobTypeName, mapStateJobToJob } from "./job.ts";

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
  attemptToken: null,
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
  attemptToken: "attempt-token-1",
};

const mapOne = (stateJob: Parameters<typeof mapStateJobToJob>[0]) =>
  mapStateJobToJob(stateJob, createNoopJobTypes());

describe("mapStateJobToJob", () => {
  it("maps the stored status through, blocked included", () => {
    expect(mapOne(pendingStateJob).status).toBe("pending");
    expect(mapOne({ ...pendingStateJob, status: "blocked" }).status).toBe("blocked");
    expect(
      mapOne({
        ...pendingStateJob,
        status: "completed",
        completedAt: new Date("2026-01-01T00:01:00Z"),
      }).status,
    ).toBe("completed");
  });

  it("carries the chain position through", () => {
    expect(mapOne(pendingStateJob).chainIndex).toBe(0);
    expect(mapOne({ ...pendingStateJob, chainIndex: 3 }).chainIndex).toBe(3);
  });

  it("decodes the input of a job and its continuation, and the output of a terminal job only", () => {
    const decodeInput = vi.fn((_typeName: string, input: unknown) => ({ decoded: input }));
    const decodeOutput = vi.fn((_typeName: string, output: unknown) => ({ decoded: output }));
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

    const job = mapStateJobToJob({ ...continuedJob, continuation }, { decodeInput, decodeOutput });

    expect(decodeInput.mock.calls).toEqual([
      ["test", { value: 1 }],
      ["test", { value: 2 }],
    ]);
    expect(decodeOutput.mock.calls).toEqual([["test", { result: 2 }]]);
    expect(job.input).toEqual({ decoded: { value: 1 } });
    expect("output" in job).toBe(false);
    expect(job.continuedTo).toMatchObject({
      input: { decoded: { value: 2 } },
      output: { decoded: { result: 2 } },
    });
  });

  it("carries the attempt fields through on a running job", () => {
    const job = mapOne(runningStateJob);

    expect(job.status).toBe("running");
    if (job.status !== "running") throw new Error("expected a running job");
    expect(job.attemptAt).toEqual(runningStateJob.attemptAt);
    expect(job.attemptBy).toBe("worker-1");
  });

  it("types the attempt fields as non-null", () => {
    const job = {} as Extract<
      Job<string, "worker-id", string, string, unknown, unknown, false>,
      { status: "running" }
    >;

    expectTypeOf(job.attemptAt).toEqualTypeOf<Date>();
    expectTypeOf(job.attemptBy).toEqualTypeOf<"worker-id">();
  });
});

describe("assertJobTypeName", () => {
  it("passes without a type name, a stored job, or a mismatch", () => {
    expect(() => {
      assertJobTypeName(
        { ...pendingStateJob, typeName: "other" },
        { jobId: "job-1", typeName: undefined },
      );
    }).not.toThrow();
    expect(() => {
      assertJobTypeName(undefined, { jobId: "job-1", typeName: "test" });
    }).not.toThrow();
    expect(() => {
      assertJobTypeName(pendingStateJob, { jobId: "job-1", typeName: "test" });
    }).not.toThrow();
  });

  it("throws JobTypeMismatchError when the stored type differs", () => {
    expect(() => {
      assertJobTypeName(
        { ...pendingStateJob, typeName: "other" },
        { jobId: "job-1", typeName: "test" },
      );
    }).toThrow(
      expect.objectContaining({
        constructor: JobTypeMismatchError,
        message: 'Expected job job-1 to have type "test" but found "other"',
        expectedTypeName: "test",
        actualTypeName: "other",
      }),
    );
  });
});
