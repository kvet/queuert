import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const unblockJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "unblockJobs",
  cases: [
    {
      name: "schedules blocked jobs when all blockers complete",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(result.length, 1);
        assert.equal(result[0].job.id, mainChain.head.id);
        assert.equal(result[0].job.status, "pending");
        assert.equal(result[0].job.completedAt, null);
        assert.equal(result[0].job.attemptAt, null);
      },
    },
    {
      name: "returns each dependent job with its own chain",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(result.length, 1);
        assert.equal(result[0].job.id, continuation.id);
        assert.equal(result[0].job.status, "pending");
        assert.equal(result[0].job.chain.id, mainChain.id);
        assert.equal(result[0].job.chain.typeName, "main");
        assert.equal(result[0].job.chain.status, "running");
      },
    },
    {
      name: "does not schedule job when not all blockers are complete",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(result.length, 1);
        assert.equal(result[0].jobId, mainChain.head.id);
        assert.equal(result[0].job.status, "blocked");

        const [stillBlocked] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        assert.equal(stillBlocked?.completedAt, null);
        assert.equal(stillBlocked?.attemptAt, null);
        assert.equal(stillBlocked?.status, "blocked");
      },
    },
    {
      name: "returns empty array when no blocked jobs exist for chain ID",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(result.length, 0);
      },
    },
    {
      name: "returns the stored blocker rows for a blocker chain",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(result.length, 1);
        assert.equal(result[0].jobId, mainChain.head.id);
        assert.equal(result[0].blockedByChainId, blockerChain.head.chainId);
        assert.equal(result[0].index, 0);
        assert.deepEqual(result[0].traceContext, traceContext);
      },
    },
    {
      name: "returns no blocker rows when nothing references the chain",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(result.length, 0);
      },
    },
    {
      name: "raises stale past scheduledAt to current time when unblocking",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(result.length, 1);
        const unblockedAt = result[0].job.scheduledAt.getTime();
        assert.ok(unblockedAt - past.getTime() > 30 * 60 * 1000);
        assert.ok(Math.abs(unblockedAt - Date.now()) < 60 * 1000);
      },
    },
    {
      name: "preserves future scheduledAt when unblocking",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(result.length, 1);
        assert.equal(result[0].job.scheduledAt.getTime(), future.getTime());
      },
    },
    {
      name: "unblocked job with stale past scheduledAt does not jump ahead of already-ready jobs",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(first.id, readyMainChain.head.id);
        assert.equal(second.id, blockedMainChain.head.id);
      },
    },
    {
      name: "returns blocker rows with a null trace context when none was stored",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(result.length, 1);
        assert.equal(result[0].jobId, mainChain.head.id);
        assert.equal(result[0].traceContext, null);
      },
    },
    {
      name: "completing a blocked job clears blocked so it never resurfaces",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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
        assert.equal(completedJob!.status, "completed");

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

        assert.equal(result.length, 1);
        assert.equal(result[0].jobId, mainChain.head.id);
        assert.equal(result[0].job.status, "completed");
        assert.notEqual(result[0].job.completedAt, null);

        const [job] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        assert.equal(job!.status, "completed");
        assert.notEqual(job!.completedAt, null);
      },
    },
  ],
};

export const unblockJobsConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "unblockJobs",
    cases: [
      {
        name: "unblocks a dependent whose blocker was added before the chain completed, without a caller pre-lock",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

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

          const added = Promise.withResolvers<void>();
          const adderGate = Promise.withResolvers<void>();
          const adderTx = stateAdapter.withTransaction(async (txCtx) => {
            const [blockerChain] = await stateAdapter.getChains({
              txCtx,
              chainIds: [chainId],
              lock: "exclusive",
            });
            assert.equal(blockerChain!.status, "running");
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
            assert.equal(blocked.status, "blocked");
            added.resolve();
            await adderGate.promise;
            return dependent;
          });
          await added.promise;

          const completerTx = stateAdapter.withTransaction(async (txCtx) => {
            const [completed] = await stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: continued!.continuation.id, output: null }],
            });
            assert.notEqual(completed, undefined);
            return stateAdapter.unblockJobs({ txCtx, blockedByChainId: chainId });
          });
          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          adderGate.resolve();
          const dependent = await adderTx;
          const unblocked = await completerTx;

          assert.deepEqual(
            unblocked.map((entry) => entry.job.id),
            [dependent.id],
          );
          const [unblockedDependent] = await stateAdapter.getJobs({ jobIds: [dependent.id] });
          assert.equal(unblockedDependent!.status, "pending");
          const [chain] = await stateAdapter.getChains({ chainIds: [chainId] });
          assert.equal(chain!.status, "completed");
        },
      },
      {
        name: "leaves a dependent pending when its blocker completed before the blocker was added, without a caller pre-lock",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

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

          const completed = Promise.withResolvers<void>();
          const completerGate = Promise.withResolvers<void>();
          const completerTx = stateAdapter.withTransaction(async (txCtx) => {
            const [completedJob] = await stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: continued!.continuation.id, output: null }],
            });
            assert.notEqual(completedJob, undefined);
            assert.deepEqual(
              await stateAdapter.unblockJobs({ txCtx, blockedByChainId: chainId }),
              [],
            );
            completed.resolve();
            await completerGate.promise;
          });
          await completed.promise;

          const adderTx = stateAdapter.withTransaction(async (txCtx) => {
            const [blockerChain] = await stateAdapter.getChains({
              txCtx,
              chainIds: [chainId],
              lock: "exclusive",
            });
            assert.equal(blockerChain!.status, "completed");
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
            assert.equal(withBlockers.status, "pending");
            return dependent;
          });
          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          completerGate.resolve();
          await completerTx;
          const dependent = await adderTx;

          const [pendingDependent] = await stateAdapter.getJobs({ jobIds: [dependent.id] });
          assert.equal(pendingDependent!.status, "pending");
          const blockers = await stateAdapter.getJobBlockers({ jobId: dependent.id });
          assert.deepEqual(
            blockers.map((blocker) => blocker.id),
            [chainId],
          );
        },
      },
      {
        name: "concurrent blocker chain completions unblock all jobs sharing those blockers",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

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
          assert.equal(stranded.length, 0);
        },
      },
    ],
  };
