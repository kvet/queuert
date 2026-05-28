import { describe, expect, it } from "vitest";

import { type StateJob } from "../state-adapter/state-adapter.js";
import { deriveJobStatus } from "./job.js";

const now = new Date("2026-01-01T12:00:00.000Z");

const baseJob = (overrides: Partial<StateJob>): StateJob => ({
  id: "j1",
  typeName: "t",
  chainId: "j1",
  chainTypeName: "t",
  continuedToJobId: null,
  hasOpenBlockers: false,
  scheduledInFuture: false,
  input: null,
  output: null,
  createdAt: now,
  scheduledAt: now,
  completedAt: null,
  completedBy: null,
  attempt: 0,
  lastAttemptError: null,
  lastAttemptAt: null,
  leasedBy: null,
  leasedUntil: null,
  deduplicationKey: null,
  chainTraceContext: null,
  traceContext: null,
  ...overrides,
});

describe("deriveJobStatus", () => {
  it("derives ready when eligible now", () => {
    expect(deriveJobStatus(baseJob({}))).toBe("ready");
  });

  it("derives scheduled when scheduledInFuture is set", () => {
    expect(deriveJobStatus(baseJob({ scheduledInFuture: true }))).toBe("scheduled");
  });

  it("derives blocked when it has open blockers", () => {
    expect(deriveJobStatus(baseJob({ hasOpenBlockers: true }))).toBe("blocked");
  });

  it("derives running when leased", () => {
    expect(
      deriveJobStatus(baseJob({ leasedUntil: new Date(now.getTime() + 1000), leasedBy: "w" })),
    ).toBe("running");
  });

  it("derives completed when terminally completed", () => {
    expect(deriveJobStatus(baseJob({ completedAt: now }))).toBe("completed");
  });

  it("derives succeeded when handed off", () => {
    expect(deriveJobStatus(baseJob({ completedAt: now, continuedToJobId: "j2" }))).toBe(
      "succeeded",
    );
  });

  it("completion wins over a stale lease", () => {
    expect(
      deriveJobStatus(baseJob({ completedAt: now, leasedUntil: new Date(now.getTime() - 1) })),
    ).toBe("completed");
  });

  it("an active lease wins over open blockers", () => {
    expect(
      deriveJobStatus(
        baseJob({ leasedUntil: new Date(now.getTime() + 1000), hasOpenBlockers: true }),
      ),
    ).toBe("running");
  });

  it("blockers win over a future schedule", () => {
    expect(deriveJobStatus(baseJob({ hasOpenBlockers: true, scheduledInFuture: true }))).toBe(
      "blocked",
    );
  });
});
