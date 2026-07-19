import { describe, expect, it } from "vitest";

import { type StateJob } from "../state-adapter/state-adapter.js";
import { deriveStatus, mapStatePairToChain } from "./chain.js";

const completedHead = {
  id: "job-1",
  chainId: "chain-1",
  typeName: "test",
  chainTypeName: "test",
  input: { value: 1 },
  output: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  scheduledAt: new Date("2026-01-01T00:00:00Z"),
  attempt: 1,
  lastAttemptAt: null,
  lastAttemptError: null,
  attemptAt: null,
  attemptBy: null,
  attemptUntil: null,
  completedAt: new Date("2026-01-01T00:01:00Z"),
  completedBy: "worker-1",
  continuedToId: null,
  blocked: false,
  deduplicationKey: null,
  chainTraceContext: null,
  traceContext: null,
} satisfies StateJob;

const continuedHead: StateJob = { ...completedHead, continuedToId: "job-2" };

describe("deriveStatus", () => {
  it("treats a continued job as a chain that is still running", () => {
    expect(deriveStatus(continuedHead)).toBe("running");
  });

  it("treats a terminally completed job as a completed chain", () => {
    expect(deriveStatus(completedHead)).toBe("completed");
  });
});

describe("mapStatePairToChain", () => {
  it("does not fabricate an output for a chain whose head has continued", () => {
    const chain = mapStatePairToChain([continuedHead, undefined]);

    expect(chain.status).toBe("running");
    expect("output" in chain).toBe(false);
    expect("completedAt" in chain).toBe(false);
  });
});
