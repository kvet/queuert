import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const startJobAttemptGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "startJobAttempt",
  cases: [
    {
      name: "acquires oldest eligible pending job",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "acquire-test", input: { order: 1 } }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "acquire-test", input: { order: 2 } }],
          }),
        );

        const acquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["acquire-test"],
          }),
        );

        expect(acquired).toBeDefined();
        expect(acquired!.input).toEqual({ order: 1 });
        expect(acquired!.attemptAt).toBeInstanceOf(Date);
        expect(acquired!.attemptBy).toBe("worker-1");
        expect(acquired!.completedAt).toBeNull();
        expect(acquired!.attempt).toBe(1);
      },
    },
    {
      name: "returns undefined when no eligible jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const acquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["nonexistent-type"],
          }),
        );

        expect(acquired).toBeUndefined();
      },
    },
    {
      name: "does not acquire blocked jobs",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocked-skip", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocked-skip", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const acquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["blocked-skip"],
          }),
        );

        expect(acquired).toBeDefined();
        expect(acquired!.id).toBe(blockerChain.head.id);
      },
    },
    {
      name: "does not acquire blocked jobs when no unblocked jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocked-only", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "worker-1",
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const [blockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocked-only", input: { value: "blocked" } }],
          }),
        );

        const [anotherBlockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocked-only", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: blockedChain.head.id,
                blockedByChainIds: [anotherBlockerChain.head.chainId],
              },
            ],
          }),
        );

        const acquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["blocked-only"],
          }),
        );

        expect(acquired).toBeDefined();
        expect(acquired!.id).toBe(anotherBlockerChain.head.id);

        const acquired2 = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["blocked-only"],
          }),
        );

        expect(acquired2).toBeUndefined();
      },
    },
    {
      name: "does not acquire jobs scheduled in the future",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "future-acquire", input: null, schedule: { afterMs: 60_000 } }],
          }),
        );

        const acquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["future-acquire"],
          }),
        );

        expect(acquired).toBeUndefined();
      },
    },
    {
      name: "parallel startJobAttempt calls return distinct jobs (no double-dispatch)",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const count = 5;
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: Array.from({ length: count }, (_, i) => ({
              typeName: "acquire-concurrency",
              input: { index: i },
            })),
          }),
        );

        const results = await Promise.all(
          Array.from({ length: count }, async () =>
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.startJobAttempt({
                txCtx,
                workerId: "worker-1",
                typeNames: ["acquire-concurrency"],
              }),
            ),
          ),
        );

        const acquiredJobs = results.filter((result) => result !== undefined);
        const acquiredIds = new Set(acquiredJobs.map((result) => result.id));

        expect(acquiredJobs).toHaveLength(count);
        expect(acquiredIds.size).toBe(count);
      },
    },
    {
      name: "returns the acquired job's chain",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "acquire-chain", input: null, chainTraceContext: "chain-trace" }],
          }),
        );

        const acquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["acquire-chain"],
          }),
        );

        expect(acquired).toBeDefined();
        expect(acquired!.chain.id).toBe(stateChain.head.chainId);
        expect(acquired!.chain.typeName).toBe("acquire-chain");
        expect(acquired!.chain.completedAt).toBeNull();
        expect(acquired!.chain.traceContext).toBe("chain-trace");
      },
    },
    {
      name: "reports hasBlockers only for jobs that have blocker rows",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "has-blockers-blocker", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "worker-1",
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const [withBlockersChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "has-blockers", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: withBlockersChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const acquiredWithBlockers = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["has-blockers"],
          }),
        );

        expect(acquiredWithBlockers).toBeDefined();
        expect(acquiredWithBlockers!.id).toBe(withBlockersChain.head.id);
        expect(acquiredWithBlockers!.hasBlockers).toBe(true);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "has-no-blockers", input: null }],
          }),
        );

        const acquiredWithoutBlockers = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["has-no-blockers"],
          }),
        );

        expect(acquiredWithoutBlockers).toBeDefined();
        expect(acquiredWithoutBlockers!.hasBlockers).toBe(false);
      },
    },
    {
      name: "holds the chain lock implicitly for a single-job chain",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "implicit-chain-lock", input: null }],
          }),
        );

        let releaseHolder: (() => void) | undefined;
        const holderGate = new Promise<void>((r) => {
          releaseHolder = r;
        });
        let signalAcquired: (() => void) | undefined;
        const jobAcquired = new Promise<void>((r) => {
          signalAcquired = r;
        });

        const holderTx = stateAdapter.withTransaction(async (txCtx) => {
          const acquired = await stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["implicit-chain-lock"],
          });
          expect(acquired!.id).toBe(stateChain.head.id);
          signalAcquired!();
          await holderGate;
        });

        await jobAcquired;

        let chainLockTaken = false;
        const waiterTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.getChains({
              txCtx,
              chainIds: [stateChain.head.chainId],
              lock: "exclusive",
            }),
          )
          .then((chains) => {
            chainLockTaken = true;
            return chains;
          });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        expect(chainLockTaken).toBe(false);

        releaseHolder!();
        await holderTx;

        const [observed] = await waiterTx;
        expect(observed!.head.attemptBy).toBe("worker-1");
      },
    },
  ],
};
