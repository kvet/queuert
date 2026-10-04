import { describe, expect, it } from "vitest";

import {
  blockedJob,
  continuedJob,
  tailJob,
  pendingJob,
  runningJob,
} from "./fixtures.spec-helper.js";
import { jobPhase } from "./jobPhase.js";

const now = 10_000;

describe("jobPhase", () => {
  it("maps blocked jobs to blocked", () => {
    expect(jobPhase(blockedJob(), now)).toEqual({ phase: "blocked" });
  });

  it("maps running jobs and flags an error left by an earlier attempt", () => {
    expect(jobPhase(runningJob(), now)).toEqual({ phase: "running", hadError: false });
    expect(jobPhase(runningJob({ lastAttemptError: "boom" }), now)).toEqual({
      phase: "running",
      hadError: true,
    });
  });

  it("maps a pending job with an error to rescheduledAfterError, whether it is due or not", () => {
    const future = pendingJob({
      attempt: 2,
      lastAttemptError: "boom",
      scheduledAt: new Date(20_000),
    });
    const due = pendingJob({ attempt: 2, lastAttemptError: "boom", scheduledAt: new Date(5000) });

    expect(jobPhase(future, now)).toEqual({ phase: "rescheduledAfterError" });
    expect(jobPhase(due, now)).toEqual({ phase: "rescheduledAfterError" });
  });

  it("maps an error-free pending job by scheduledAt and flags attempts already started", () => {
    expect(jobPhase(pendingJob({ scheduledAt: new Date(20_000) }), now)).toEqual({
      phase: "scheduled",
      rescheduled: false,
    });
    expect(jobPhase(pendingJob({ scheduledAt: new Date(20_000), attempt: 1 }), now)).toEqual({
      phase: "scheduled",
      rescheduled: true,
    });
    expect(jobPhase(pendingJob({ scheduledAt: new Date(now) }), now)).toEqual({
      phase: "due",
      rescheduled: false,
    });
    expect(jobPhase(pendingJob({ scheduledAt: new Date(0), attempt: 3 }), now)).toEqual({
      phase: "due",
      rescheduled: true,
    });
  });

  it("splits completed jobs into continued and tail, flagging workerless completion", () => {
    expect(jobPhase(continuedJob("a"), now)).toEqual({ phase: "continued", workerless: false });
    expect(jobPhase(continuedJob("a", { attempt: 0 }), now)).toEqual({
      phase: "continued",
      workerless: true,
    });
    expect(jobPhase(tailJob("a"), now)).toEqual({ phase: "tail", workerless: false });
    expect(jobPhase(tailJob("a", { attempt: 0 }), now)).toEqual({
      phase: "tail",
      workerless: true,
    });
  });
});
