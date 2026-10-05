import { sleep } from "../../helpers/sleep.js";
import { type StateBlockedJob, type StateChain } from "../../state-adapter/state-adapter.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const deleteChainsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "deleteChains",
  cases: [
    {
      name: "deletes all jobs in the given chains",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "delete-test", input: null }],
          }),
        );

        const [deleted] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [stateChain.head.chainId],
          }),
        );

        const deletedChain = deleted as StateChain;
        expect(deletedChain.id).toBe(stateChain.id);
        expect(deletedChain.head.id).toBe(stateChain.head.id);
        expect(deletedChain.tail).toBeUndefined();
        expect(await stateAdapter.getJobs({ jobIds: [stateChain.head.id] })).toEqual([undefined]);
      },
    },
    {
      name: "does not delete jobs from other chains",
      run: async ({ stateAdapter }, expect) => {
        const [chainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "chain-a", input: null }],
          }),
        );

        const [chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "chain-b", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [chainA.head.chainId],
          }),
        );

        expect(await stateAdapter.getJobs({ jobIds: [chainA.head.id] })).toEqual([undefined]);
        const [jobB] = await stateAdapter.getJobs({ jobIds: [chainB.head.id] });
        expect(jobB?.id).toBe(chainB.head.id);
      },
    },
    {
      name: "deletes every job of a multi-job chain and reports its continuation as the tail",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "delete-multi", input: null }],
          }),
        );
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [{ typeName: "delete-multi-step", continueFromId: stateChain.id, input: null }],
          }),
        );
        const continuationId = continued!.continuation.id;

        const [deleted] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [stateChain.id] }),
        );

        const deletedChain = deleted as StateChain;
        expect(deletedChain.id).toBe(stateChain.id);
        expect(deletedChain.head.id).toBe(stateChain.id);
        expect(deletedChain.tail?.id).toBe(continuationId);
        expect(await stateAdapter.getJobs({ jobIds: [stateChain.id, continuationId] })).toEqual([
          undefined,
          undefined,
        ]);
        const chainJobs = await stateAdapter.listChainJobs({
          chainId: stateChain.id,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(chainJobs.items).toEqual([]);
      },
    },
    {
      name: "deleting a dependent chain alone releases its blocker references",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "blocker", input: null },
              { typeName: "main", input: null },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.id] }],
          }),
        );

        const [deletedMain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [mainChain.id] }),
        );
        expect((deletedMain as StateChain).id).toBe(mainChain.id);

        const blockedJobs = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.id,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(blockedJobs.items).toEqual([]);
        expect(
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id }),
          ),
        ).toEqual([]);

        const [deletedBlocker] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.id] }),
        );
        expect((deletedBlocker as StateChain).id).toBe(blockerChain.id);
      },
    },
    {
      name: "deletes nothing and returns the referencing blocker rows when a chain is an outside blocker",
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

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const [blockerResult] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.head.chainId] }),
        );
        expect(Array.isArray(blockerResult)).toBe(true);
        const references = blockerResult as StateBlockedJob[];
        expect(references).toHaveLength(1);
        expect(references[0].jobId).toBe(mainChain.head.id);
        expect(references[0].blockedByChainId).toBe(blockerChain.id);
        expect(references[0].job.id).toBe(mainChain.head.id);

        const [blockerStillThere] = await stateAdapter.getJobs({ jobIds: [blockerChain.head.id] });
        expect(blockerStillThere?.id).toBe(blockerChain.head.id);

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({
            txCtx,
            chainIds: [mainChain.head.chainId, blockerChain.head.chainId],
          }),
        );

        expect(results).toHaveLength(2);
        expect((results[0] as StateChain).id).toBe(mainChain.id);
        expect((results[1] as StateChain).id).toBe(blockerChain.id);
      },
    },
    {
      name: "deletes a repeated id once, reporting it at every position, and rolls back cleanly",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "delete-repeated", input: null }],
          }),
        );
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              { typeName: "delete-repeated:step", continueFromId: stateChain.id, input: null },
            ],
          }),
        );
        const continuationId = continued!.continuation.id;

        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            const results = await stateAdapter.deleteChains({
              txCtx,
              chainIds: [stateChain.id, stateChain.id],
            });
            expect(results.map((result) => (result as StateChain).id)).toEqual([
              stateChain.id,
              stateChain.id,
            ]);
            throw new Error("rollback after deleting a repeated id");
          }),
        ).rejects.toThrow("rollback after deleting a repeated id");

        const runningChains = await stateAdapter.listChains({
          typeName: "delete-repeated",
          status: "running",
          orderBy: "createdAt",
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(runningChains.items.map((chain) => chain.id)).toEqual([stateChain.id]);
        expect(
          await stateAdapter.countByChainTypeNames({ typeNames: ["delete-repeated"] }),
        ).toEqual([
          { running: { count: 1, hasMore: false }, completed: { count: 0, hasMore: false } },
        ]);
        expect(
          await stateAdapter.countByJobTypeNames({ typeNames: ["delete-repeated:step"] }),
        ).toEqual([
          {
            blocked: { count: 0, hasMore: false },
            pending: { count: 1, hasMore: false },
            running: { count: 0, hasMore: false },
            completed: { count: 0, hasMore: false },
          },
        ]);

        const [acquired, acquiredAgain] = await stateAdapter.withTransaction(async (txCtx) => [
          await stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "delete-repeated:step": 30_000 },
          }),
          await stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "delete-repeated:step": 30_000 },
          }),
        ]);
        expect(acquired?.id).toBe(continuationId);
        expect(acquiredAgain).toBeUndefined();

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [stateChain.id, stateChain.id] }),
        );
        expect(results.map((result) => (result as StateChain).id)).toEqual([
          stateChain.id,
          stateChain.id,
        ]);
        expect(await stateAdapter.getJobs({ jobIds: [stateChain.id, continuationId] })).toEqual([
          undefined,
          undefined,
        ]);
      },
    },
    {
      name: "reports undefined for a chain batched with an outside-referenced one and deletes neither",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain, mainChain, freeChain] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { typeName: "mixed-delete-blocker", input: null },
                { typeName: "mixed-delete-main", input: null },
                { typeName: "mixed-delete-free", input: null },
              ],
            }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.id] }],
          }),
        );

        const [blockerResult, freeResult] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.id, freeChain.id] }),
        );

        expect((blockerResult as StateBlockedJob[]).map((reference) => reference.jobId)).toEqual([
          mainChain.id,
        ]);
        expect(freeResult).toBeUndefined();
        const chains = await stateAdapter.getChains({ chainIds: [blockerChain.id, freeChain.id] });
        expect(chains.map((chain) => chain?.id)).toEqual([blockerChain.id, freeChain.id]);
      },
    },
    {
      name: "reports undefined for a missing id and deletes the rest",
      run: async ({ stateAdapter, generateId }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "delete-missing", input: null }],
          }),
        );
        const missingId = (generateId ?? (() => crypto.randomUUID()))();

        const [deleted, missing] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [stateChain.id, missingId] }),
        );

        expect((deleted as StateChain).id).toBe(stateChain.id);
        expect(missing).toBeUndefined();
        expect(await stateAdapter.getJobs({ jobIds: [stateChain.id] })).toEqual([undefined]);
      },
    },
    {
      name: "reports undefined for a continuation id and deletes nothing",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "delete-continuation-id", input: null }],
          }),
        );
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "delete-continuation-id:step",
                continueFromId: stateChain.id,
                input: null,
              },
            ],
          }),
        );
        const continuationId = continued!.continuation.id;

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [continuationId] }),
        );

        expect(result).toBeUndefined();
        const jobs = await stateAdapter.getJobs({ jobIds: [stateChain.id, continuationId] });
        expect(jobs.map((job) => job?.id)).toEqual([stateChain.id, continuationId]);
      },
    },
    {
      name: "sees a blocker reference committed while it waited on the head lock",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "late-reference-blocker", input: null }],
          }),
        );

        let signalBlockerAdded: (() => void) | undefined;
        const blockerAdded = new Promise<void>((r) => {
          signalBlockerAdded = r;
        });
        let releaseAdder: (() => void) | undefined;
        const adderGate = new Promise<void>((r) => {
          releaseAdder = r;
        });

        const adderTx = stateAdapter.withTransaction(async (txCtx) => {
          const [blockedChain] = await stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "late-reference-blocked", input: null }],
          });
          await stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: blockedChain.head.id, blockedByChainIds: [blockerChain.id] }],
          });
          signalBlockerAdded!();
          await adderGate;
          return blockedChain;
        });

        await blockerAdded;

        let deleteSettled = false;
        const deleteTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.id] }),
          )
          .finally(() => {
            deleteSettled = true;
          });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        expect(deleteSettled).toBe(false);

        releaseAdder!();
        const blockedChain = await adderTx;

        const [result] = await deleteTx;
        expect(Array.isArray(result)).toBe(true);
        expect((result as StateBlockedJob[]).map((ref) => ref.jobId)).toEqual([
          blockedChain.head.id,
        ]);

        const [blockerStillThere] = await stateAdapter.getChains({ chainIds: [blockerChain.id] });
        expect(blockerStillThere?.id).toBe(blockerChain.id);
      },
    },
    {
      name: "deletes a continuation committed while it waited on the head lock",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "late-continuation", input: null }],
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
          await stateAdapter.getJobs({ txCtx, jobIds: [stateChain.head.id], lock: "exclusive" });
          const [result] = await stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "late-continuation:step",
                input: null,
                continueFromId: stateChain.head.id,
              },
            ],
          });
          signalContinued!();
          await continuerGate;
          return result!.continuation;
        });

        await continued;

        let deleteSettled = false;
        const deleteTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [stateChain.id] }),
          )
          .finally(() => {
            deleteSettled = true;
          });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        expect(deleteSettled).toBe(false);

        releaseContinuer!();
        const continuation = await continuerTx;

        const [deleted] = await deleteTx;
        expect((deleted as StateChain).tail?.id).toBe(continuation.id);
        expect(
          await stateAdapter.getJobs({ jobIds: [stateChain.head.id, continuation.id] }),
        ).toEqual([undefined, undefined]);
      },
    },
  ],
};
