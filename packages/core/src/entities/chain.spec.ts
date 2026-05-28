import { describe, expect, it } from "vitest";

import { type StateJob } from "../state-adapter/state-adapter.js";
import { deriveChainStatus } from "./chain.js";

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

describe("deriveChainStatus", () => {
  it("is open when the tail is not completed", () => {
    expect(deriveChainStatus(baseJob({}))).toBe("open");
  });

  it("is closed when the tail is terminally completed", () => {
    expect(deriveChainStatus(baseJob({ completedAt: now }))).toBe("closed");
  });
});
