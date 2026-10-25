import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const startJobAttemptGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "startJobAttempts",
  cases: [
    {
      name: "acquires oldest eligible pending job",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "acquire-test",
                input: { order: 1 },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "acquire-test",
                input: { order: 2 },
              },
            ],
          }),
        );

        const [acquired] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "acquire-test": 30_000 },
            limit: 1,
          }),
        );

        expect(acquired).toBeDefined();
        expect(acquired.input).toEqual({ order: 1 });
        expect(acquired.status).toBe("running");
        expect(acquired.attemptAt).toBeInstanceOf(Date);
        expect(acquired.attemptBy).toBe("worker-1");
        expect(acquired.completedAt).toBeNull();
        expect(acquired.attempt).toBe(1);
      },
    },
    {
      name: "returns no jobs when no eligible jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const acquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "nonexistent-type": 30_000 },
            limit: 1,
          }),
        );

        expect(acquired).toEqual([]);
      },
    },
    {
      name: "does not acquire blocked jobs",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "blocked-skip", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "blocked-skip", input: null }],
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

        const [acquired] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "blocked-skip": 30_000 },
            limit: 1,
          }),
        );

        expect(acquired).toBeDefined();
        expect(acquired.id).toBe(blockerChain.head.id);
      },
    },
    {
      name: "does not acquire blocked jobs when no unblocked jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "blocked-only", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const [blockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "blocked-only",
                input: { value: "blocked" },
              },
            ],
          }),
        );

        const [anotherBlockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "blocked-only", input: null }],
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

        const [acquired] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "blocked-only": 30_000 },
            limit: 1,
          }),
        );

        expect(acquired).toBeDefined();
        expect(acquired.id).toBe(anotherBlockerChain.head.id);

        const acquired2 = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "blocked-only": 30_000 },
            limit: 1,
          }),
        );

        expect(acquired2).toEqual([]);
      },
    },
    {
      name: "does not acquire jobs scheduled in the future",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "future-acquire",
                input: null,
                schedule: { afterMs: 60_000 },
              },
            ],
          }),
        );

        const acquired = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "future-acquire": 30_000 },
            limit: 1,
          }),
        );

        expect(acquired).toEqual([]);
      },
    },
    {
      name: "parallel calls return distinct jobs (no double-dispatch)",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        if (transactionConcurrency !== "concurrent") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const count = 5;
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: Array.from({ length: count }, (_, i) => ({
              id: stateAdapter.config.generateId(),
              typeName: "acquire-concurrency",
              input: { index: i },
            })),
          }),
        );

        const results = await Promise.all(
          Array.from({ length: count }, async () =>
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.startJobAttempts({
                txCtx,
                workerId: "worker-1",
                timeoutMsByTypeName: { "acquire-concurrency": 30_000 },
                limit: 1,
              }),
            ),
          ),
        );

        const acquiredJobs = results.flat();
        const acquiredIds = new Set(acquiredJobs.map((result) => result.id));

        expect(acquiredJobs).toHaveLength(count);
        expect(acquiredIds.size).toBe(count);
      },
    },
    {
      name: "acquires up to limit jobs, oldest first",
      run: async ({ stateAdapter }, expect) => {
        const createdChains = [];
        for (let order = 1; order <= 3; order++) {
          const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateId(),
                  typeName: "acquire-limit",
                  input: { order },
                },
              ],
            }),
          );
          createdChains.push(createdChain);
        }

        const firstBatch = await stateAdapter.startJobAttempts({
          workerId: "worker-1",
          timeoutMsByTypeName: { "acquire-limit": 30_000 },
          limit: 2,
        });
        expect(firstBatch.map((job) => job.id).sort()).toEqual(
          [createdChains[0].head.id, createdChains[1].head.id].sort(),
        );
        for (const job of firstBatch) {
          expect(job.status).toBe("running");
          expect(job.attemptBy).toBe("worker-1");
          expect(job.attempt).toBe(1);
        }

        const secondBatch = await stateAdapter.startJobAttempts({
          workerId: "worker-1",
          timeoutMsByTypeName: { "acquire-limit": 30_000 },
          limit: 5,
        });
        expect(secondBatch.map((job) => job.id)).toEqual([createdChains[2].head.id]);
      },
    },
    {
      name: "acquires jobs of several types in one call",
      run: async ({ stateAdapter }, expect) => {
        const [chainA, chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "acquire-multi-a", input: null },
              { id: stateAdapter.config.generateId(), typeName: "acquire-multi-b", input: null },
            ],
          }),
        );

        const acquired = await stateAdapter.startJobAttempts({
          workerId: "worker-1",
          timeoutMsByTypeName: { "acquire-multi-a": 10_000, "acquire-multi-b": 20_000 },
          limit: 5,
        });

        expect(acquired.map((job) => job.id).sort()).toEqual(
          [chainA.head.id, chainB.head.id].sort(),
        );
        for (const job of acquired) {
          expect(job.chain.id).toBe(job.chainId);
          expect(job.hasBlockers).toBe(false);
        }
      },
    },
    {
      name: "parallel batched calls return disjoint jobs",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        if (transactionConcurrency !== "concurrent") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const count = 10;
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: Array.from({ length: count }, (_, index) => ({
              id: stateAdapter.config.generateId(),
              typeName: "acquire-batch-concurrency",
              input: { index },
            })),
          }),
        );

        const results = await Promise.all(
          Array.from({ length: 4 }, async () =>
            stateAdapter.startJobAttempts({
              workerId: "worker-1",
              timeoutMsByTypeName: { "acquire-batch-concurrency": 30_000 },
              limit: 3,
            }),
          ),
        );
        const acquiredIds = results.flat().map((job) => job.id);

        expect(new Set(acquiredIds).size).toBe(acquiredIds.length);
        for (const batch of results) {
          expect(batch.length).toBeLessThanOrEqual(3);
        }

        const remaining = await stateAdapter.startJobAttempts({
          workerId: "worker-1",
          timeoutMsByTypeName: { "acquire-batch-concurrency": 30_000 },
          limit: count,
        });
        expect(acquiredIds.length + remaining.length).toBe(count);
      },
    },
    {
      name: "returns the acquired job's chain",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "acquire-chain",
                input: null,
                chainTraceContext: "chain-trace",
              },
            ],
          }),
        );

        const [acquired] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "acquire-chain": 30_000 },
            limit: 1,
          }),
        );

        expect(acquired).toBeDefined();
        expect(acquired.chain.id).toBe(stateChain.head.chainId);
        expect(acquired.chain.typeName).toBe("acquire-chain");
        expect(acquired.chain.completedAt).toBeNull();
        expect(acquired.chain.traceContext).toBe("chain-trace");
      },
    },
    {
      name: "reports hasBlockers only for jobs that have blocker rows",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "has-blockers-blocker",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const [withBlockersChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "has-blockers", input: null }],
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

        const [acquiredWithBlockers] = await stateAdapter.startJobAttempts({
          workerId: "worker-1",
          timeoutMsByTypeName: { "has-blockers": 30_000 },
          limit: 1,
        });

        expect(acquiredWithBlockers).toBeDefined();
        expect(acquiredWithBlockers.id).toBe(withBlockersChain.head.id);
        expect(acquiredWithBlockers.hasBlockers).toBe(true);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "has-no-blockers", input: null },
            ],
          }),
        );

        const [acquiredWithoutBlockers] = await stateAdapter.startJobAttempts({
          workerId: "worker-1",
          timeoutMsByTypeName: { "has-no-blockers": 30_000 },
          limit: 1,
        });

        expect(acquiredWithoutBlockers).toBeDefined();
        expect(acquiredWithoutBlockers.hasBlockers).toBe(false);
      },
    },
    {
      name: "acquires a due job while only its chain head is locked",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        if (transactionConcurrency !== "concurrent") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const [lockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "locked-head", input: null }],
          }),
        );
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "locked-head-acquire",
                input: null,
                continueFromId: lockedChain.head.id,
              },
            ],
          }),
        );
        const continuation = continued!.continuation;

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
          ).toBe(0);

          const [acquired] = await stateAdapter.startJobAttempts({
            workerId: "worker-1",
            timeoutMsByTypeName: { "locked-head-acquire": 30_000 },
            limit: 1,
          });
          expect(acquired?.id).toBe(continuation.id);
        } finally {
          releaseHead!();
          await lockerTx;
        }
      },
    },
    {
      name: "skips a due job whose row is locked and getStartAttemptDelayMs ignores it",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        if (transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const [lockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "locked-job", input: null }],
          }),
        );

        let signalJobLocked: (() => void) | undefined;
        const jobLocked = new Promise<void>((r) => {
          signalJobLocked = r;
        });
        let releaseJob: (() => void) | undefined;
        const jobGate = new Promise<void>((r) => {
          releaseJob = r;
        });

        const lockerTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getJobs({ txCtx, jobIds: [lockedChain.head.id], lock: "exclusive" });
          signalJobLocked!();
          await jobGate;
        });

        await jobLocked;

        try {
          expect(
            await stateAdapter.getStartAttemptDelayMs({ typeNames: ["locked-job"] }),
          ).toBeNull();

          const [otherChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateId(), typeName: "locked-job", input: null }],
            }),
          );
          expect(await stateAdapter.getStartAttemptDelayMs({ typeNames: ["locked-job"] })).toBe(0);

          const [acquired] = await stateAdapter.startJobAttempts({
            workerId: "worker-1",
            timeoutMsByTypeName: { "locked-job": 30_000 },
            limit: 1,
          });
          expect(acquired?.id).toBe(otherChain.head.id);
        } finally {
          releaseJob!();
          await lockerTx;
        }

        const [acquiredAfterRelease] = await stateAdapter.startJobAttempts({
          workerId: "worker-1",
          timeoutMsByTypeName: { "locked-job": 30_000 },
          limit: 1,
        });
        expect(acquiredAfterRelease?.id).toBe(lockedChain.head.id);
      },
    },
    {
      name: "sets attemptUntil from the acquired job type's timeout",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "timeout-short", input: null },
              { id: stateAdapter.config.generateId(), typeName: "timeout-long", input: null },
            ],
          }),
        );

        const timeoutMsByTypeName = { "timeout-short": 10_000, "timeout-long": 120_000 };
        const before = Date.now();
        const [first] = await stateAdapter.startJobAttempts({
          workerId: "worker-1",
          timeoutMsByTypeName,
          limit: 1,
        });
        const [second] = await stateAdapter.startJobAttempts({
          workerId: "worker-1",
          timeoutMsByTypeName,
          limit: 1,
        });
        const after = Date.now();

        const acquired = [first, second].sort((a, b) => a.typeName.localeCompare(b.typeName));
        expect(acquired.map((job) => job.typeName)).toEqual(["timeout-long", "timeout-short"]);
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
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "timeout-other", input: null },
            ],
          }),
        );

        const acquired = await stateAdapter.startJobAttempts({
          workerId: "worker-1",
          timeoutMsByTypeName: { "timeout-unrelated": 10_000 },
          limit: 1,
        });
        expect(acquired).toEqual([]);
      },
    },
    {
      name: "acquires without a txCtx, committing the attempt on its own",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "acquire-autocommit", input: null },
            ],
          }),
        );

        const [acquired] = await stateAdapter.startJobAttempts({
          workerId: "worker-1",
          timeoutMsByTypeName: { "acquire-autocommit": 30_000 },
          limit: 1,
        });
        expect(acquired.id).toBe(createdChain.head.id);
        expect(acquired.status).toBe("running");
        expect(acquired.attempt).toBe(1);

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.status).toBe("running");
        expect(stored!.attempt).toBe(1);
        expect(stored!.attemptBy).toBe("worker-1");

        const again = await stateAdapter.startJobAttempts({
          workerId: "worker-2",
          timeoutMsByTypeName: { "acquire-autocommit": 30_000 },
          limit: 1,
        });
        expect(again).toEqual([]);
      },
    },
  ],
};
