import { sleep } from "../../helpers/sleep.js";
import { type StateChain } from "../../state-adapter/state-adapter.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const addJobsBlockersGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "addJobsBlockers",
  cases: [
    {
      name: "adds blockers and reports the blocker chain as incomplete",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        expect(result.completedAt).toBeNull();
        expect(result.attemptAt).toBeNull();
        expect(result.status).toBe("blocked");
        expect(result.blockers).toHaveLength(1);
        expect(result.blockers[0]!.id).toBe(blockerChain.head.chainId);
        expect(result.blockers[0]!.completedAt).toBeNull();
      },
    },
    {
      name: "reports a completed blocker chain and leaves the job unblocked",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        expect(result.completedAt).toBeNull();
        expect(result.attemptAt).toBeNull();
        expect(result.status).toBe("pending");
        expect(result.blockers).toHaveLength(1);
        expect(result.blockers[0]!.completedAt).toBeInstanceOf(Date);
      },
    },
    {
      name: "reports an undefined blocker for an unknown blocker chain",
      run: async ({ stateAdapter }, expect) => {
        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const missingChainId =
          mainChain.head.chainId.slice(0, -1) + (mainChain.head.chainId.endsWith("0") ? "1" : "0");

        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            const [result] = await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [missingChainId] }],
            });
            expect(result.blockers).toHaveLength(1);
            expect(result.blockers[0]).toBeUndefined();
            throw new Error("caller aborts");
          }),
        ).rejects.toThrow("caller aborts");

        const [unchanged] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        expect(unchanged!.status).toBe("pending");
        expect(await stateAdapter.getJobBlockers({ jobId: mainChain.head.id })).toHaveLength(0);
      },
    },
    {
      name: "adds blockers to multiple jobs in a single batch",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain1, blockerChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "blocker", input: null },
              { typeName: "blocker", input: null },
            ],
          }),
        );

        const [mainChain1, mainChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "main", input: null },
              { typeName: "main", input: null },
            ],
          }),
        );

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain1.head.id, blockedByChainIds: [blockerChain1.head.chainId] },
              {
                jobId: mainChain2.head.id,
                blockedByChainIds: [blockerChain1.head.chainId, blockerChain2.head.chainId],
              },
            ],
          }),
        );

        expect(results).toHaveLength(2);
        expect(results[0].id).toBe(mainChain1.head.id);
        expect(results[0].completedAt).toBeNull();
        expect(results[0].attemptAt).toBeNull();
        expect(results[0].status).toBe("blocked");
        expect(results[0].blockers.map((blocker) => blocker!.id)).toEqual([
          blockerChain1.head.chainId,
        ]);

        expect(results[1].id).toBe(mainChain2.head.id);
        expect(results[1].completedAt).toBeNull();
        expect(results[1].attemptAt).toBeNull();
        expect(results[1].status).toBe("blocked");
        expect(results[1].blockers.map((blocker) => blocker!.id)).toEqual([
          blockerChain1.head.chainId,
          blockerChain2.head.chainId,
        ]);
      },
    },
    {
      name: "batch handles mix of blocked and unblocked jobs",
      run: async ({ stateAdapter }, expect) => {
        const [completedBlockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "test",
            jobs: [{ jobId: completedBlockerChain.head.id, output: null }],
          }),
        );

        const [incompleteBlockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [mainChain1, mainChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "main", input: null },
              { typeName: "main", input: null },
            ],
          }),
        );

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain1.head.id,
                blockedByChainIds: [completedBlockerChain.head.chainId],
              },
              {
                jobId: mainChain2.head.id,
                blockedByChainIds: [incompleteBlockerChain.head.chainId],
              },
            ],
          }),
        );

        expect(results).toHaveLength(2);
        expect(results[0].id).toBe(mainChain1.head.id);
        expect(results[0].completedAt).toBeNull();
        expect(results[0].attemptAt).toBeNull();
        expect(results[0].status).toBe("pending");
        expect(results[0].blockers[0]!.completedAt).toBeInstanceOf(Date);

        expect(results[1].id).toBe(mainChain2.head.id);
        expect(results[1].completedAt).toBeNull();
        expect(results[1].attemptAt).toBeNull();
        expect(results[1].status).toBe("blocked");
        expect(results[1].blockers[0]!.id).toBe(incompleteBlockerChain.head.chainId);
        expect(results[1].blockers[0]!.completedAt).toBeNull();
      },
    },
    {
      name: "returns the blocker chain's own trace context",
      run: async ({ stateAdapter }, expect) => {
        const blockerChainTraceContext = "00-test123-chain456-01";
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                input: null,
                chainTraceContext: blockerChainTraceContext,
              },
            ],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        expect(result.blockers).toHaveLength(1);
        expect(result.blockers[0]!.traceContext).toEqual(blockerChainTraceContext);
      },
    },
    {
      name: "returns blockers in the same order as blockedByChainIds",
      run: async ({ stateAdapter }, expect) => {
        const chainTraceA = "00-aaa111-chain-aaa-01";
        const chainTraceB = "00-bbb222-chain-bbb-01";

        const [blockerChainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blockerA",
                input: null,
                chainTraceContext: chainTraceA,
              },
            ],
          }),
        );

        const [blockerChainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blockerB",
                input: null,
                chainTraceContext: chainTraceB,
              },
            ],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain.head.id,
                blockedByChainIds: [blockerChainA.head.chainId, blockerChainB.head.chainId],
              },
            ],
          }),
        );

        expect(result.blockers).toHaveLength(2);
        expect(result.blockers[0]!.traceContext).toEqual(chainTraceA);
        expect(result.blockers[1]!.traceContext).toEqual(chainTraceB);
      },
    },
    {
      name: "reports an undefined blocker for a continuation job id",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({ txCtx, jobs: [{ typeName: "blocker", input: null }] }),
        );
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null, continueFromId: headChain.head.id }],
          }),
        );
        const { continuation } = continued!;

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({ txCtx, jobs: [{ typeName: "main", input: null }] }),
        );

        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            const [result] = await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [continuation.id] }],
            });
            expect(result.blockers[0]).toBeUndefined();
            throw new Error("caller aborts");
          }),
        ).rejects.toThrow("caller aborts");

        const [after] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        expect(after!.status).toBe("pending");
        expect(await stateAdapter.getJobBlockers({ jobId: mainChain.head.id })).toHaveLength(0);
      },
    },
    {
      name: "duplicate blocker chain ids do not break addJobsBlockers",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain.head.id,
                blockedByChainIds: [
                  blockerChain.head.chainId,
                  blockerChain.head.chainId,
                  blockerChain.head.chainId,
                ],
              },
            ],
          }),
        );

        expect(result.status).toBe("blocked");
        expect(result.blockers.map((blocker) => blocker!.id)).toEqual([
          blockerChain.head.chainId,
          blockerChain.head.chainId,
          blockerChain.head.chainId,
        ]);
      },
    },
    {
      name: "reports a blocker chain deleted while it waited on the head lock as missing",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "deleted-blocker", input: null },
              { typeName: "main", input: null },
            ],
          }),
        );

        let signalDeleted: (() => void) | undefined;
        const deleted = new Promise<void>((r) => {
          signalDeleted = r;
        });
        let releaseDeleter: (() => void) | undefined;
        const deleterGate = new Promise<void>((r) => {
          releaseDeleter = r;
        });

        const deleteTx = stateAdapter.withTransaction(async (txCtx) => {
          const result = await stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.id] });
          signalDeleted!();
          await deleterGate;
          return result;
        });

        await deleted;

        let addSettled = false;
        const addTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
            }),
          )
          .finally(() => {
            addSettled = true;
          });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        expect(addSettled).toBe(false);

        releaseDeleter!();
        const [deletedChain] = await deleteTx;
        expect((deletedChain as StateChain).id).toBe(blockerChain.id);

        const [added] = await addTx;
        expect(added.blockers).toEqual([undefined]);
        expect(added.status).toBe("pending");
        const blockedJobs = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.id,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(blockedJobs.items).toEqual([]);
      },
    },
    {
      name: "reports a blocker chain continued while it waited on the head lock as incomplete",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "continued-blocker", input: null },
              { typeName: "main", input: null },
            ],
          }),
        );

        let signalContinued: (() => void) | undefined;
        const continued = new Promise<void>((r) => {
          signalContinued = r;
        });
        let releaseContinuer: (() => void) | undefined;
        const continuerGate = new Promise<void>((r) => {
          releaseContinuer = r;
        });

        const continuerTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getJobs({ txCtx, jobIds: [blockerChain.head.id], lock: "exclusive" });
          await stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "continued-blocker:step",
                input: null,
                continueFromId: blockerChain.head.id,
              },
            ],
          });
          signalContinued!();
          await continuerGate;
        });

        await continued;

        let addSettled = false;
        const addTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
            }),
          )
          .finally(() => {
            addSettled = true;
          });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        expect(addSettled).toBe(false);

        releaseContinuer!();
        await continuerTx;

        const [added] = await addTx;
        expect(added.status).toBe("blocked");
        expect(added.blockers.map((blocker) => blocker?.status)).toEqual(["running"]);
      },
    },
    {
      name: "reports a blocker chain completed while it waited on the head lock as complete",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "completed-blocker", input: null },
              { typeName: "main", input: null },
            ],
          }),
        );

        let signalCompleted: (() => void) | undefined;
        const completed = new Promise<void>((r) => {
          signalCompleted = r;
        });
        let releaseCompleter: (() => void) | undefined;
        const completerGate = new Promise<void>((r) => {
          releaseCompleter = r;
        });

        const completerTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getJobs({ txCtx, jobIds: [blockerChain.head.id], lock: "exclusive" });
          await stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          });
          signalCompleted!();
          await completerGate;
        });

        await completed;

        let addSettled = false;
        const addTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
            }),
          )
          .finally(() => {
            addSettled = true;
          });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        expect(addSettled).toBe(false);

        releaseCompleter!();
        await completerTx;

        const [added] = await addTx;
        expect(added.status).toBe("pending");
        expect(added.blockers.map((blocker) => blocker?.status)).toEqual(["completed"]);
      },
    },
  ],
};
