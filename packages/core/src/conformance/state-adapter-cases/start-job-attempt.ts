import { sleep } from "@queuert/helpers";

import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const startJobAttemptGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "startJobAttempts",
  cases: [
    {
      name: "acquires oldest eligible pending job",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["acquire-test"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
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
                id: stateAdapter.config.generateJobId(),
                typeName: "acquire-test",
                input: { order: 2 },
              },
            ],
          }),
        );

        const [acquired] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["acquire-test"],
          limit: 1,
        });

        expect(acquired).toBeDefined();
        expect(acquired.input).toEqual({ order: 1 });
        expect(acquired.status).toBe("running");
        expect(acquired.attemptAt).toBeInstanceOf(Date);
        expect(acquired.attemptBy).toBe(worker.id);
        expect(typeof acquired.attemptToken).toBe("string");
        expect(acquired.completedAt).toBeNull();
        expect(acquired.attempt).toBe(1);
      },
    },
    {
      name: "returns no jobs when no eligible jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["nonexistent-type"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const acquired = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["nonexistent-type"],
          limit: 1,
        });

        expect(acquired).toEqual([]);
      },
    },
    {
      name: "does not acquire blocked jobs",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["blocked-skip"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocked-skip", input: null },
            ],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocked-skip", input: null },
            ],
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

        const [acquired] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["blocked-skip"],
          limit: 1,
        });

        expect(acquired).toBeDefined();
        expect(acquired.id).toBe(blockerChain.head.id);
      },
    },
    {
      name: "does not acquire blocked jobs when no unblocked jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["blocked-only"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocked-only", input: null },
            ],
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
                id: stateAdapter.config.generateJobId(),
                typeName: "blocked-only",
                input: { value: "blocked" },
              },
            ],
          }),
        );

        const [anotherBlockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocked-only", input: null },
            ],
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

        const [acquired] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["blocked-only"],
          limit: 1,
        });

        expect(acquired).toBeDefined();
        expect(acquired.id).toBe(anotherBlockerChain.head.id);

        const acquired2 = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["blocked-only"],
          limit: 1,
        });

        expect(acquired2).toEqual([]);
      },
    },
    {
      name: "does not acquire jobs scheduled in the future",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["future-acquire"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "future-acquire",
                input: null,
                schedule: { afterMs: 60_000 },
              },
            ],
          }),
        );

        const acquired = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["future-acquire"],
          limit: 1,
        });

        expect(acquired).toEqual([]);
      },
    },
    {
      name: "parallel calls return distinct jobs (no double-dispatch)",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["acquire-concurrency"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        if (transactionConcurrency !== "concurrent") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const count = 5;
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: Array.from({ length: count }, (_, i) => ({
              id: stateAdapter.config.generateJobId(),
              typeName: "acquire-concurrency",
              input: { index: i },
            })),
          }),
        );

        const results = await Promise.all(
          Array.from({ length: count }, async () =>
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["acquire-concurrency"],
              limit: 1,
            }),
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
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["acquire-limit"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const createdChains = [];
        for (let order = 1; order <= 3; order++) {
          const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "acquire-limit",
                  input: { order },
                },
              ],
            }),
          );
          createdChains.push(createdChain);
        }

        const firstBatch = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["acquire-limit"],
          limit: 2,
        });
        expect(firstBatch.map((job) => job.id).sort()).toEqual(
          [createdChains[0].head.id, createdChains[1].head.id].sort(),
        );
        for (const job of firstBatch) {
          expect(job.status).toBe("running");
          expect(job.attemptBy).toBe(worker.id);
          expect(job.attempt).toBe(1);
        }
        expect(new Set(firstBatch.map((job) => job.attemptToken)).size).toBe(firstBatch.length);

        const secondBatch = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["acquire-limit"],
          limit: 5,
        });
        expect(secondBatch.map((job) => job.id)).toEqual([createdChains[2].head.id]);
      },
    },
    {
      name: "acquires jobs of several types in one call",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["acquire-multi-a", "acquire-multi-b"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [chainA, chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "acquire-multi-a", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "acquire-multi-b", input: null },
            ],
          }),
        );

        const acquired = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["acquire-multi-a", "acquire-multi-b"],
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
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["acquire-batch-concurrency"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        if (transactionConcurrency !== "concurrent") {
          expect.skip("requires concurrent transactions");
          return;
        }
        const count = 10;
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: Array.from({ length: count }, (_, index) => ({
              id: stateAdapter.config.generateJobId(),
              typeName: "acquire-batch-concurrency",
              input: { index },
            })),
          }),
        );

        const results = await Promise.all(
          Array.from({ length: 4 }, async () =>
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["acquire-batch-concurrency"],
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
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["acquire-batch-concurrency"],
          limit: count,
        });
        expect(acquiredIds.length + remaining.length).toBe(count);
      },
    },
    {
      name: "returns the acquired job's chain",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["acquire-chain"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "acquire-chain",
                input: null,
                chainTraceContext: "chain-trace",
              },
            ],
          }),
        );

        const [acquired] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["acquire-chain"],
          limit: 1,
        });

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
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["has-blockers", "has-no-blockers"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
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
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "has-blockers", input: null },
            ],
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
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["has-blockers"],
          limit: 1,
        });

        expect(acquiredWithBlockers).toBeDefined();
        expect(acquiredWithBlockers.id).toBe(withBlockersChain.head.id);
        expect(acquiredWithBlockers.hasBlockers).toBe(true);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "has-no-blockers", input: null },
            ],
          }),
        );

        const [acquiredWithoutBlockers] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["has-no-blockers"],
          limit: 1,
        });

        expect(acquiredWithoutBlockers).toBeDefined();
        expect(acquiredWithoutBlockers.hasBlockers).toBe(false);
      },
    },
    {
      name: "acquires a due job while only its chain head is locked",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["locked-head-acquire"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        if (transactionConcurrency !== "concurrent") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const [lockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "locked-head", input: null },
            ],
          }),
        );
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
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
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["locked-head-acquire"],
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
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["locked-job"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        if (transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const [lockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "locked-job", input: null },
            ],
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
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "locked-job", input: null },
              ],
            }),
          );
          expect(await stateAdapter.getStartAttemptDelayMs({ typeNames: ["locked-job"] })).toBe(0);

          const [acquired] = await stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["locked-job"],
            limit: 1,
          });
          expect(acquired?.id).toBe(otherChain.head.id);
        } finally {
          releaseJob!();
          await lockerTx;
        }

        const [acquiredAfterRelease] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["locked-job"],
          limit: 1,
        });
        expect(acquiredAfterRelease?.id).toBe(lockedChain.head.id);
      },
    },
    {
      name: "only acquires jobs of typeNames",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["timeout-unrelated"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "timeout-other", input: null },
            ],
          }),
        );

        const acquired = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["timeout-unrelated"],
          limit: 1,
        });
        expect(acquired).toEqual([]);
      },
    },
    {
      name: "acquires without a txCtx, committing the attempt on its own",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["acquire-autocommit"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const otherWorker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["acquire-autocommit"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "acquire-autocommit",
                input: null,
              },
            ],
          }),
        );

        const [acquired] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["acquire-autocommit"],
          limit: 1,
        });
        expect(acquired.id).toBe(createdChain.head.id);
        expect(acquired.status).toBe("running");
        expect(acquired.attempt).toBe(1);

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.status).toBe("running");
        expect(stored!.attempt).toBe(1);
        expect(stored!.attemptBy).toBe(worker.id);

        const again = await stateAdapter.startJobAttempts({
          workerId: otherWorker.id,
          workerToken: otherWorker.token,
          typeNames: ["acquire-autocommit"],
          limit: 1,
        });
        expect(again).toEqual([]);
      },
    },
    {
      name: "claims nothing for a worker with no row",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "gate-no-row", input: null },
            ],
          }),
        );

        expect(
          await stateAdapter.startJobAttempts({
            workerId: stateAdapter.config.generateWorkerId(),
            workerToken: crypto.randomUUID(),
            typeNames: ["gate-no-row"],
            limit: 1,
          }),
        ).toEqual([]);

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.status).toBe("pending");
        expect(stored!.attempt).toBe(0);
        expect(stored!.attemptBy).toBeNull();
      },
    },
    {
      name: "claims nothing once the worker's lease expired",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["gate-expired"],
          concurrency: 1,
          leaseMs: 1,
        });
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "gate-expired", input: null },
            ],
          }),
        );
        await sleep(20);

        expect(
          await stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["gate-expired"],
            limit: 1,
          }),
        ).toEqual([]);

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.status).toBe("pending");
        expect(stored!.attempt).toBe(0);
        expect(stored!.attemptBy).toBeNull();
      },
    },
    {
      name: "claims nothing after the worker stopped",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["gate-stopped"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "gate-stopped", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "gate-stopped", input: null },
            ],
          }),
        );

        expect(
          await stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["gate-stopped"],
            limit: 1,
          }),
        ).toHaveLength(1);

        await stateAdapter.stopWorker({
          workerId: worker.id,
          workerToken: worker.token,
        });

        expect(
          await stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["gate-stopped"],
            limit: 1,
          }),
        ).toEqual([]);
      },
    },
    {
      name: "claims nothing for a stale run of the worker",
      run: async ({ stateAdapter }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();
        const staleRun = await stateAdapter.startWorker({
          workerId,
          typeNames: ["gate-stale-run"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.stopWorker({ workerId, workerToken: staleRun.token });
        await sleep(5);
        const currentRun = await stateAdapter.startWorker({
          workerId,
          typeNames: ["gate-stale-run"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        expect(currentRun.startedAt.getTime()).not.toBe(staleRun.startedAt.getTime());
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "gate-stale-run", input: null },
            ],
          }),
        );

        expect(
          await stateAdapter.startJobAttempts({
            workerId,
            workerToken: staleRun.token,
            typeNames: ["gate-stale-run"],
            limit: 1,
          }),
        ).toEqual([]);

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.status).toBe("pending");
        expect(stored!.attempt).toBe(0);
        expect(stored!.attemptBy).toBeNull();

        const [claimed] = await stateAdapter.startJobAttempts({
          workerId,
          workerToken: currentRun.token,
          typeNames: ["gate-stale-run"],
          limit: 1,
        });
        expect(claimed.id).toBe(createdChain.head.id);
        expect(claimed.attemptBy).toBe(workerId);
      },
    },
    {
      name: "a claim waiting on a transaction that locks and deletes the worker claims nothing",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["gate-reclaimed"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "gate-reclaimed", input: null },
            ],
          }),
        );

        const reclaimerGate = Promise.withResolvers<void>();
        const workerLocked = Promise.withResolvers<void>();

        const reclaimerTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getWorkers({ txCtx, workerIds: [worker.id], lock: "exclusive" });
          workerLocked.resolve();
          await reclaimerGate.promise;
          await stateAdapter.stopWorker({
            txCtx,
            workerId: worker.id,
            workerToken: worker.token,
          });
        });

        await workerLocked.promise;

        const claim = stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["gate-reclaimed"],
          limit: 1,
        });

        expect(
          await Promise.race([
            claim.then(() => "resolved"),
            sleep(LOCK_BLOCK_OBSERVATION_MS).then(() => "waiting"),
          ]),
        ).toBe("waiting");

        reclaimerGate.resolve();
        await reclaimerTx;

        expect(await claim).toEqual([]);
        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.status).toBe("pending");
        expect(stored!.attemptBy).toBeNull();
      },
    },
    {
      name: "claims a job whose schedule passed during an open transaction",
      run: async ({ stateAdapter }, expect) => {
        const jobId = stateAdapter.config.generateJobId();

        const acquired = await stateAdapter.withTransaction(async (txCtx) => {
          const worker = await stateAdapter.startWorker({
            txCtx,
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["acquire-schedule-in-tx"],
            concurrency: 1,
            leaseMs: 60_000,
          });
          await stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: jobId,
                typeName: "acquire-schedule-in-tx",
                input: null,
                schedule: { afterMs: 100 },
              },
            ],
          });
          await sleep(300);
          return stateAdapter.startJobAttempts({
            txCtx,
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["acquire-schedule-in-tx"],
            limit: 1,
          });
        });

        expect(acquired.map((job) => job.id)).toEqual([jobId]);
      },
    },
  ],
};
