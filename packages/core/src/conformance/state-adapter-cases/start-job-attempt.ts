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
            timeoutMsByTypeName: { "acquire-test": 30_000 },
          }),
        );

        expect(acquired).toBeDefined();
        expect(acquired!.input).toEqual({ order: 1 });
        expect(acquired!.status).toBe("running");
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
            timeoutMsByTypeName: { "nonexistent-type": 30_000 },
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
            timeoutMsByTypeName: { "blocked-skip": 30_000 },
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
            timeoutMsByTypeName: { "blocked-only": 30_000 },
          }),
        );

        expect(acquired).toBeDefined();
        expect(acquired!.id).toBe(anotherBlockerChain.head.id);

        const acquired2 = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "blocked-only": 30_000 },
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
            timeoutMsByTypeName: { "future-acquire": 30_000 },
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
                timeoutMsByTypeName: { "acquire-concurrency": 30_000 },
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
            timeoutMsByTypeName: { "acquire-chain": 30_000 },
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
            timeoutMsByTypeName: { "implicit-chain-lock": 30_000 },
          });
          try {
            expect(acquired?.id).toBe(stateChain.head.id);
          } finally {
            signalAcquired!();
          }
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
    {
      name: "skips a due job whose chain head is locked and getStartAttemptDelayMs ignores it",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const [lockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "locked-head", input: null }],
          }),
        );
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              { typeName: "locked-head-acquire", input: null, continueFromId: lockedChain.head.id },
            ],
          }),
        );
        const lockedHeadJob = continued!.continuation;

        let signalHeadLocked: (() => void) | undefined;
        const headLocked = new Promise<void>((r) => {
          signalHeadLocked = r;
        });
        let releaseHead: (() => void) | undefined;
        const headGate = new Promise<void>((r) => {
          releaseHead = r;
        });

        const lockerTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getChains({ txCtx, chainIds: [lockedChain.id], lock: "exclusive" });
          signalHeadLocked!();
          await headGate;
        });

        await headLocked;

        try {
          expect(
            await stateAdapter.getStartAttemptDelayMs({ typeNames: ["locked-head-acquire"] }),
          ).toBeNull();

          const [otherChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ typeName: "locked-head-acquire", input: null }],
            }),
          );
          expect(
            await stateAdapter.getStartAttemptDelayMs({ typeNames: ["locked-head-acquire"] }),
          ).toBe(0);

          const acquired = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({
              txCtx,
              workerId: "worker-1",
              timeoutMsByTypeName: { "locked-head-acquire": 30_000 },
            }),
          );
          expect(acquired?.id).toBe(otherChain.head.id);
        } finally {
          releaseHead!();
          await lockerTx;
        }

        const acquiredAfterRelease = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "locked-head-acquire": 30_000 },
          }),
        );
        expect(acquiredAfterRelease?.id).toBe(lockedHeadJob.id);
      },
    },
    {
      name: "sets attemptUntil from the acquired job type's timeout",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "lease-short", input: null },
              { typeName: "lease-long", input: null },
            ],
          }),
        );

        const timeoutMsByTypeName = { "lease-short": 10_000, "lease-long": 120_000 };
        const before = Date.now();
        const first = await stateAdapter.startJobAttempt({
          workerId: "worker-1",
          timeoutMsByTypeName,
        });
        const second = await stateAdapter.startJobAttempt({
          workerId: "worker-1",
          timeoutMsByTypeName,
        });
        const after = Date.now();

        const acquired = [first!, second!].sort((a, b) => a.typeName.localeCompare(b.typeName));
        expect(acquired.map((job) => job.typeName)).toEqual(["lease-long", "lease-short"]);
        for (const job of acquired) {
          const timeoutMs = timeoutMsByTypeName[job.typeName as keyof typeof timeoutMsByTypeName];
          expect(job.attemptUntil).toBeInstanceOf(Date);
          expect(job.attemptUntil!.getTime()).toBeGreaterThanOrEqual(before + timeoutMs - 1_000);
          expect(job.attemptUntil!.getTime()).toBeLessThanOrEqual(after + timeoutMs + 1_000);
        }

        const stored = await stateAdapter.getJobs({ jobIds: acquired.map((job) => job.id) });
        expect(stored.map((job) => job!.attemptUntil!.getTime())).toEqual(
          acquired.map((job) => job.attemptUntil!.getTime()),
        );
      },
    },
    {
      name: "only acquires jobs of the timeoutMsByTypeName keys",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({ txCtx, jobs: [{ typeName: "lease-other", input: null }] }),
        );

        const acquired = await stateAdapter.startJobAttempt({
          workerId: "worker-1",
          timeoutMsByTypeName: { "lease-unrelated": 10_000 },
        });
        expect(acquired).toBeUndefined();
      },
    },
    {
      name: "acquires without a txCtx, committing the attempt on its own",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "acquire-autocommit", input: null }],
          }),
        );

        const acquired = await stateAdapter.startJobAttempt({
          workerId: "worker-1",
          timeoutMsByTypeName: { "acquire-autocommit": 30_000 },
        });
        expect(acquired!.id).toBe(createdChain.head.id);
        expect(acquired!.status).toBe("running");
        expect(acquired!.attempt).toBe(1);

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.status).toBe("running");
        expect(stored!.attempt).toBe(1);
        expect(stored!.attemptBy).toBe("worker-1");

        const again = await stateAdapter.startJobAttempt({
          workerId: "worker-2",
          timeoutMsByTypeName: { "acquire-autocommit": 30_000 },
        });
        expect(again).toBeUndefined();
      },
    },
  ],
};
