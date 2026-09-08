import { extendWithPostgres } from "@queuert/testcontainers";
import { it as baseIt, describe, expect } from "vitest";

import { extendWithVarianceStatePg } from "./state-adapter-variance.spec-helper.js";

const it = extendWithVarianceStatePg(extendWithPostgres(baseIt, import.meta.url), {
  schema: "public",
});

it("index");

const delay = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// TODO!!!: this file is fucked. we should have only conformance tests for such things

describe("PostgreSQL State Adapter Concurrency", () => {
  it("reports hasBlockedJobs for a blocker committed before the head row lock is granted", async ({
    stateAdapter,
  }) => {
    const [blockerChain, blockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [
          { typeName: "blocker", input: null },
          { typeName: "blocked", input: null },
        ],
      }),
    );
    const [{ continuation }] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.continueJobs({
        txCtx,
        jobs: [{ typeName: "blocker:step", input: null, continueFromId: blockerChain.head.id }],
      }),
    );

    let onBlockerAdded: () => void = () => {};
    const blockerAdded = new Promise<void>((resolve) => (onBlockerAdded = resolve));
    let onCommitAdder: () => void = () => {};
    const commitAdder = new Promise<void>((resolve) => (onCommitAdder = resolve));

    const adder = stateAdapter.withTransaction(async (txCtx) => {
      await stateAdapter.addJobsBlockers({
        txCtx,
        jobBlockers: [{ jobId: blockedChain.head.id, blockedByChainIds: [blockerChain.id] }],
      });
      onBlockerAdded();
      await commitAdder;
    });

    await blockerAdded;

    const completer = stateAdapter.withTransaction(async (txCtx) => {
      await stateAdapter.getJobs({ txCtx, jobIds: [continuation.id], lock: "exclusive" });
      return stateAdapter.completeJobs({
        txCtx,
        jobs: [{ jobId: continuation.id, output: null }],
      });
    });

    await delay(500);
    onCommitAdder();
    await adder;

    const [completed] = await completer;
    expect(completed.hasBlockedJobs).toBe(true);

    const unblockedResults = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id }),
    );
    expect(unblockedResults.map((r) => r.job.id)).toEqual([blockedChain.head.id]);
  });
});
