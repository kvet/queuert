import { sleep } from "@queuert/helpers";

import { type ConformanceGroup } from "../runner.js";
import { forEachIsolationPair } from "./isolation-pairs.js";
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
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
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
              { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
            ],
          }),
        );

        const continuation = await stateAdapter.withTransaction(async (txCtx) => {
          const [continued] = await stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
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
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [blockerBChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
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
      name: "unblocks a dependent that lists one blocker chain at two positions once that chain completes",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id, blockerChain.id] },
            ],
          }),
        );

        const result = await stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          });
          return stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id });
        });

        expect(result.map((entry) => [entry.index, entry.job.status])).toEqual([
          [0, "pending"],
          [1, "pending"],
        ]);
        const [main] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        expect(main!.status).toBe("pending");
      },
    },
    {
      name: "keeps a dependent with three blockers blocked until the last one completes, in any completion order",
      run: async ({ stateAdapter }, expect) => {
        const completionOrders = [
          [0, 1, 2],
          [0, 2, 1],
          [1, 0, 2],
          [1, 2, 0],
          [2, 0, 1],
          [2, 1, 0],
        ];
        for (const completionOrder of completionOrders) {
          const chains = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: ["blocker", "blocker", "blocker", "main"].map((typeName) => ({
                id: stateAdapter.config.generateJobId(),
                typeName,
                input: null,
              })),
            }),
          );
          const blockerChains = chains.slice(0, 3);
          const mainChain = chains[3];

          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                {
                  jobId: mainChain.head.id,
                  blockedByChainIds: blockerChains.map((chain) => chain.id),
                },
              ],
            }),
          );

          const statusesAfterEachCompletion = [];
          for (const blockerIndex of completionOrder) {
            const blockerChain = blockerChains[blockerIndex];
            await stateAdapter.withTransaction(async (txCtx) => {
              await stateAdapter.completeJobs({
                txCtx,
                jobs: [{ jobId: blockerChain.head.id, output: null }],
              });
              await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id });
            });
            const [main] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
            statusesAfterEachCompletion.push(main!.status);
          }

          expect(statusesAfterEachCompletion).toEqual(["blocked", "blocked", "pending"]);
        }
      },
    },
    {
      name: "returns empty array when no blocked jobs exist for chain ID",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "standalone", input: null },
            ],
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
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
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
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "standalone", input: null },
            ],
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
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
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
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
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
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["fairness-main"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const longPast = new Date(Date.now() - 60 * 60 * 1000);
        const recentPast = new Date(Date.now() - 60 * 1000);

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "fairness-blocker",
                input: null,
              },
            ],
          }),
        );

        const [blockedMainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
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
                id: stateAdapter.config.generateJobId(),
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

        const [first] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["fairness-main"],
          limit: 1,
        });
        const [second] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["fairness-main"],
          limit: 1,
        });

        expect(first.id).toBe(readyMainChain.head.id);
        expect(second.id).toBe(blockedMainChain.head.id);
      },
    },
    {
      name: "returns blocker rows with a null trace context when none was stored",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
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
      run: async (fixture, expect) => {
        const { stateAdapter, transactionConcurrency } = fixture;
        await forEachIsolationPair(fixture, async ({ first, second }) => {
          const [{ id: chainId }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "race-add-first",
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
                  id: stateAdapter.config.generateJobId(),
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
                  id: stateAdapter.config.generateJobId(),
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
            const dependent = await stateAdapter.withTransaction(async (txCtx) =>
              addBlocker(txCtx),
            );
            const { completed, unblocked } = await stateAdapter.withTransaction(completeChain);
            expect(completed).toBeDefined();
            dependentId = dependent.id;
            unblockedIds = unblocked.map((entry) => entry.job.id);
          } else {
            const added = Promise.withResolvers<void>();
            const adderGate = Promise.withResolvers<void>();
            const adderTx = first.withTransaction(async (txCtx) =>
              addBlocker(txCtx, async () => {
                added.resolve();
                await adderGate.promise;
              }),
            );
            await added.promise;
            const completerTx = second.withTransaction(completeChain);
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
        });
      },
    },
    {
      name: "leaves a dependent pending when its blocker completed before the blocker was added, without a caller pre-lock",
      run: async (fixture, expect) => {
        const { stateAdapter, transactionConcurrency } = fixture;
        await forEachIsolationPair(fixture, async ({ first, second }) => {
          const [{ id: chainId }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
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
                  id: stateAdapter.config.generateJobId(),
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
                  id: stateAdapter.config.generateJobId(),
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
            const completerTx = first.withTransaction(async (txCtx) =>
              completeChain(txCtx, async () => {
                completedSignal.resolve();
                await completerGate.promise;
              }),
            );
            await completedSignal.promise;
            const adderTx = second.withTransaction(addBlocker);
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
        });
      },
    },
    {
      name: "unblocks a dependent added to a chain that already had a dependent while its completion waited on the head lock",
      run: async (fixture, expect) => {
        const { stateAdapter, transactionConcurrency } = fixture;
        if (transactionConcurrency !== "concurrent") {
          expect.skip("requires concurrent transactions");
          return;
        }

        await forEachIsolationPair(fixture, async ({ first, second }) => {
          const [blockerChain, earlierDependent] = await stateAdapter.withTransaction(
            async (txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: ["second-dependent:blocker", "second-dependent:dependent"].map(
                  (typeName) => ({
                    id: stateAdapter.config.generateJobId(),
                    typeName,
                    input: null,
                  }),
                ),
              }),
          );
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: earlierDependent.id, blockedByChainIds: [blockerChain.id] }],
            }),
          );

          const added = Promise.withResolvers<void>();
          const adderGate = Promise.withResolvers<void>();
          const adderTx = first.withTransaction(async (txCtx) => {
            await stateAdapter.getChains({ txCtx, chainIds: [blockerChain.id], lock: "exclusive" });
            const [laterDependent] = await stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "second-dependent:dependent",
                  input: null,
                },
              ],
            });
            await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: laterDependent.id, blockedByChainIds: [blockerChain.id] }],
            });
            added.resolve();
            await adderGate.promise;
            return laterDependent;
          });
          await added.promise;

          const completerTx = second.withTransaction(async (txCtx) => {
            await stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerChain.head.id, output: null }],
            });
            return stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id });
          });
          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          adderGate.resolve();
          const laterDependent = await adderTx;
          const unblocked = await completerTx;

          expect(unblocked.map((entry) => entry.job.id).sort()).toEqual(
            [earlierDependent.id, laterDependent.id].sort(),
          );
          const dependents = await stateAdapter.getJobs({
            jobIds: [earlierDependent.id, laterDependent.id],
          });
          expect(dependents.map((job) => job!.status)).toEqual(["pending", "pending"]);
        });
      },
    },
    {
      name: "concurrent blocker chain completions unblock all jobs sharing those blockers",
      run: async (fixture, expect) => {
        const { stateAdapter, transactionConcurrency } = fixture;
        await forEachIsolationPair(fixture, async ({ first, second }) => {
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
                  id: stateAdapter.config.generateJobId(),
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
                  id: stateAdapter.config.generateJobId(),
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
            blockerJobs.map(async (blocker, index) =>
              (index % 2 === 0 ? first : second).withTransaction(async (txCtx) => {
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
        });
      },
    },
    {
      name: "completing a blocked job clears blocked so it never resurfaces",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
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
