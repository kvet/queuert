import { sleep } from "@queuert/helpers";

import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const unblockJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "unblockJobs",
  cases: [
    {
      name: "schedules blocked jobs when all blockers complete",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "main", input: null }],
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].job.id).toBe(mainChain.head.id);
        expect(result[0].job.status).toBe("pending");
        expect(result[0].job.completedAt).toBeNull();
        expect(result[0].job.attemptAt).toBeNull();
      },
    },
    {
      name: "returns each dependent job with its own chain",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "blocker", input: null },
              { id: stateAdapter.config.generateId(), typeName: "main", input: null },
            ],
          }),
        );

        const continuation = await stateAdapter.withTransaction(async (txCtx) => {
          const [continued] = await stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "main:step",
                continueFromId: mainChain.id,
                input: null,
              },
            ],
          });
          await stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: continued!.continuation.id, blockedByChainIds: [blockerChain.id] },
            ],
          });
          return continued!.continuation;
        });

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].job.id).toBe(continuation.id);
        expect(result[0].job.status).toBe("pending");
        expect(result[0].job.chain.id).toBe(mainChain.id);
        expect(result[0].job.chain.typeName).toBe("main");
        expect(result[0].job.chain.status).toBe("running");
      },
    },
    {
      name: "does not schedule job when not all blockers are complete",
      run: async ({ stateAdapter }, expect) => {
        const [blockerAChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "blocker", input: null }],
          }),
        );

        const [blockerBChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "main", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain.head.id,
                blockedByChainIds: [blockerAChain.head.chainId, blockerBChain.head.chainId],
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerAChain.head.id, output: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerAChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].jobId).toBe(mainChain.head.id);
        expect(result[0].job.status).toBe("blocked");

        const [stillBlocked] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        expect(stillBlocked?.completedAt).toBeNull();
        expect(stillBlocked?.attemptAt).toBeNull();
        expect(stillBlocked?.status).toBe("blocked");
      },
    },
    {
      name: "returns empty array when no blocked jobs exist for chain ID",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "standalone", input: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: stateChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(0);
      },
    },
    {
      name: "returns the stored blocker rows for a blocker chain",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "main", input: null }],
          }),
        );

        const traceContext = "00-test-span-123-01";

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain.head.id,
                blockedByChainIds: [blockerChain.head.chainId],
                blockerTraceContexts: [traceContext],
              },
            ],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].jobId).toBe(mainChain.head.id);
        expect(result[0].blockedByChainId).toBe(blockerChain.head.chainId);
        expect(result[0].index).toBe(0);
        expect(result[0].traceContext).toEqual(traceContext);
      },
    },
    {
      name: "returns no blocker rows when nothing references the chain",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "standalone", input: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: stateChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(0);
      },
    },
    {
      name: "raises stale past scheduledAt to current time when unblocking",
      run: async ({ stateAdapter }, expect) => {
        const past = new Date(Date.now() - 60 * 60 * 1000);

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "main",
                input: null,
                schedule: { at: past },
              },
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        const unblockedAt = result[0].job.scheduledAt.getTime();
        expect(unblockedAt - past.getTime()).toBeGreaterThan(30 * 60 * 1000);
        expect(Math.abs(unblockedAt - Date.now())).toBeLessThan(60 * 1000);
      },
    },
    {
      name: "preserves future scheduledAt when unblocking",
      run: async ({ stateAdapter }, expect) => {
        const future = new Date(Date.now() + 60 * 60 * 1000);

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "main",
                input: null,
                schedule: { at: future },
              },
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].job.scheduledAt.getTime()).toBe(future.getTime());
      },
    },
    {
      name: "unblocked job with stale past scheduledAt does not jump ahead of already-ready jobs",
      run: async ({ stateAdapter }, expect) => {
        const longPast = new Date(Date.now() - 60 * 60 * 1000);
        const recentPast = new Date(Date.now() - 60 * 1000);

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "fairness-blocker", input: null },
            ],
          }),
        );

        const [blockedMainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "fairness-main",
                input: { kind: "blocked-since-creation" },
                schedule: { at: longPast },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: blockedMainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const [readyMainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "fairness-main",
                input: { kind: "ready" },
                schedule: { at: recentPast },
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

        await new Promise((resolve) => setTimeout(resolve, 10));

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        const first = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "fairness-main": 30_000 },
          }),
        );
        const second = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "fairness-main": 30_000 },
          }),
        );

        expect(first!.id).toBe(readyMainChain.head.id);
        expect(second!.id).toBe(blockedMainChain.head.id);
      },
    },
    {
      name: "returns blocker rows with a null trace context when none was stored",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "main", input: null }],
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

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].jobId).toBe(mainChain.head.id);
        expect(result[0].traceContext).toBeNull();
      },
    },
    {
      name: "unblocks a dependent whose blocker was added before the chain completed, without a caller pre-lock",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        const [{ id: chainId }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "race-add-first", input: null },
            ],
          }),
        );
        // Completing the tail writes the chain head as a separate row.
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "race-add-first:step",
                input: null,
                continueFromId: chainId,
              },
            ],
          }),
        );
        const tailId = continued!.continuation.id;

        const addBlocker = async (txCtx: unknown, onAdded?: () => Promise<void>) => {
          const [blockerChain] = await stateAdapter.getChains({
            txCtx,
            chainIds: [chainId],
            lock: "exclusive",
          });
          expect(blockerChain!.status).toBe("running");
          const [dependent] = await stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "race-add-first:dependent",
                input: null,
              },
            ],
          });
          const [blocked] = await stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: dependent.id, blockedByChainIds: [chainId] }],
          });
          expect(blocked.status).toBe("blocked");
          await onAdded?.();
          return dependent;
        };
        const completeChain = async (txCtx: unknown) => {
          const [completed] = await stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: tailId, output: null }],
          });
          const unblocked = await stateAdapter.unblockJobs({ txCtx, blockedByChainId: chainId });
          return { completed, unblocked };
        };

        let dependentId: string;
        let unblockedIds: string[];
        if (transactionConcurrency === "serialized") {
          const dependent = await stateAdapter.withTransaction(async (txCtx) => addBlocker(txCtx));
          const { completed, unblocked } = await stateAdapter.withTransaction(completeChain);
          expect(completed).toBeDefined();
          dependentId = dependent.id;
          unblockedIds = unblocked.map((entry) => entry.job.id);
        } else {
          const added = Promise.withResolvers<void>();
          const adderGate = Promise.withResolvers<void>();
          const adderTx = stateAdapter.withTransaction(async (txCtx) =>
            addBlocker(txCtx, async () => {
              added.resolve();
              await adderGate.promise;
            }),
          );
          await added.promise;
          const completerTx = stateAdapter.withTransaction(completeChain);
          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          adderGate.resolve();
          const dependent = await adderTx;
          const { completed, unblocked } = await completerTx;
          expect(completed).toBeDefined();
          dependentId = dependent.id;
          unblockedIds = unblocked.map((entry) => entry.job.id);
        }

        expect(unblockedIds).toEqual([dependentId]);
        const [dependent] = await stateAdapter.getJobs({ jobIds: [dependentId] });
        expect(dependent!.status).toBe("pending");
        const [chain] = await stateAdapter.getChains({ chainIds: [chainId] });
        expect(chain!.status).toBe("completed");
      },
    },
    {
      name: "leaves a dependent pending when its blocker completed before the blocker was added, without a caller pre-lock",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        const [{ id: chainId }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "race-complete-first",
                input: null,
              },
            ],
          }),
        );
        // Completing the tail writes the chain head as a separate row.
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "race-complete-first:step",
                input: null,
                continueFromId: chainId,
              },
            ],
          }),
        );
        const tailId = continued!.continuation.id;

        const addBlocker = async (txCtx: unknown) => {
          const [blockerChain] = await stateAdapter.getChains({
            txCtx,
            chainIds: [chainId],
            lock: "exclusive",
          });
          expect(blockerChain!.status).toBe("completed");
          const [dependent] = await stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "race-complete-first:dependent",
                input: null,
              },
            ],
          });
          const [withBlockers] = await stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: dependent.id, blockedByChainIds: [chainId] }],
          });
          expect(withBlockers.status).toBe("pending");
          return dependent;
        };
        const completeChain = async (txCtx: unknown, onCompleted?: () => Promise<void>) => {
          const [completed] = await stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: tailId, output: null }],
          });
          expect(completed).toBeDefined();
          const unblocked = await stateAdapter.unblockJobs({ txCtx, blockedByChainId: chainId });
          expect(unblocked).toEqual([]);
          await onCompleted?.();
        };

        let dependentId: string;
        if (transactionConcurrency === "serialized") {
          await stateAdapter.withTransaction(async (txCtx) => completeChain(txCtx));
          const dependent = await stateAdapter.withTransaction(addBlocker);
          dependentId = dependent.id;
        } else {
          const completedSignal = Promise.withResolvers<void>();
          const completerGate = Promise.withResolvers<void>();
          const completerTx = stateAdapter.withTransaction(async (txCtx) =>
            completeChain(txCtx, async () => {
              completedSignal.resolve();
              await completerGate.promise;
            }),
          );
          await completedSignal.promise;
          const adderTx = stateAdapter.withTransaction(addBlocker);
          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          completerGate.resolve();
          await completerTx;
          const dependent = await adderTx;
          dependentId = dependent.id;
        }

        const [dependent] = await stateAdapter.getJobs({ jobIds: [dependentId] });
        expect(dependent!.status).toBe("pending");
        const blockers = await stateAdapter.getJobBlockers({ jobId: dependentId });
        expect(blockers.map((blocker) => blocker.id)).toEqual([chainId]);
      },
    },
    {
      name: "concurrent blocker chain completions unblock all jobs sharing those blockers",
      run: async ({ stateAdapter, transactionConcurrency }, expect) => {
        if (transactionConcurrency !== "concurrent") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const blockerCount = 5;
        const mainCount = 5;

        const blockerJobs = await stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: blockerCount }, (_, index) => ({
                id: stateAdapter.config.generateId(),
                typeName: "shared-blocker",
                input: { index },
              })),
            }),
          )
          .then((results) => results.map((r) => r.head));

        const mainJobs = await stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: mainCount }, (_, index) => ({
                id: stateAdapter.config.generateId(),
                typeName: "shared-main",
                input: { index },
              })),
            }),
          )
          .then((results) => results.map((r) => r.head));

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: mainJobs.map((main) => ({
              jobId: main.id,
              blockedByChainIds: blockerJobs.map((b) => b.chainId),
            })),
          }),
        );

        let readyCount = 0;
        const allReady = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();

        const allDone = Promise.all(
          blockerJobs.map(async (blocker) =>
            stateAdapter.withTransaction(async (txCtx) => {
              readyCount++;
              if (readyCount === blockerCount) allReady.resolve();
              await release.promise;
              await stateAdapter.completeJobs({
                txCtx,
                jobs: [{ jobId: blocker.id, output: null }],
              });
              await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blocker.chainId });
            }),
          ),
        );

        await allReady.promise;
        release.resolve();
        await allDone;

        const finalStates = await Promise.all(
          mainJobs.map(async (main) => stateAdapter.getJobs({ jobIds: [main.id] })),
        );

        const stranded = finalStates.filter(([job]) => job?.status === "blocked");
        expect(stranded).toHaveLength(0);
      },
    },
    {
      name: "completing a blocked job clears blocked so it never resurfaces",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "main", input: null }],
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: mainChain.head.id, output: "done" }],
          }),
        );

        const [completedJob] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        expect(completedJob!.status).toBe("completed");

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.unblockJobs({
            txCtx,
            blockedByChainId: blockerChain.head.chainId,
          }),
        );

        expect(result).toHaveLength(1);
        expect(result[0].jobId).toBe(mainChain.head.id);
        expect(result[0].job.status).toBe("completed");
        expect(result[0].job.completedAt).not.toBeNull();

        const [job] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        expect(job!.status).toBe("completed");
        expect(job!.completedAt).not.toBeNull();
      },
    },
  ],
};
