import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { caseBody, resource } from "@queuert/helpers/case-body";
import { sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import { inTransaction } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateBlockedJob, StateChain } from "../../state-adapter/state-adapter.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const deleteChainsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "deleteChains",
  cases: [
    {
      name: "deletes all jobs in the given chains",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "delete-test", input: null },
              ],
            }),
          ),
        );

        const [deleted] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({
              txCtx,
              chainIds: [stateChain.head.chainId],
            }),
          ),
        );

        const deletedChain = deleted as StateChain;
        assert.equal(deletedChain.id, stateChain.id);
        assert.equal(deletedChain.head.id, stateChain.head.id);
        assert.equal(deletedChain.tail, undefined);
        assert.deepEqual(yield* step(stateAdapter.getJobs({ jobIds: [stateChain.head.id] })), [
          undefined,
        ]);
      }),
    },
    {
      name: "does not delete jobs from other chains",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [chainA] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "chain-a", input: null }],
            }),
          ),
        );

        const [chainB] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "chain-b", input: null }],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({
              txCtx,
              chainIds: [chainA.head.chainId],
            }),
          ),
        );

        assert.deepEqual(yield* step(stateAdapter.getJobs({ jobIds: [chainA.head.id] })), [
          undefined,
        ]);
        const [jobB] = yield* step(stateAdapter.getJobs({ jobIds: [chainB.head.id] }));
        assert.equal(jobB?.id, chainB.head.id);
      }),
    },
    {
      name: "deletes every job of a multi-job chain and reports its continuation as the tail",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "delete-multi", input: null },
              ],
            }),
          ),
        );
        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "delete-multi-step",
                  continueFromId: stateChain.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const continuationId = continued!.continuation.id;

        const [deleted] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [stateChain.id] }),
          ),
        );

        const deletedChain = deleted as StateChain;
        assert.equal(deletedChain.id, stateChain.id);
        assert.equal(deletedChain.head.id, stateChain.id);
        assert.equal(deletedChain.tail?.id, continuationId);
        assert.deepEqual(
          yield* step(stateAdapter.getJobs({ jobIds: [stateChain.id, continuationId] })),
          [undefined, undefined],
        );
        const chainJobs = yield* step(
          stateAdapter.listChainJobs({
            chainId: stateChain.id,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(chainJobs.items, []);
      }),
    },
    {
      name: "deleting a dependent chain alone releases its blocker references",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain, mainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.id] }],
            }),
          ),
        );

        const [deletedMain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [mainChain.id] }),
          ),
        );
        assert.equal((deletedMain as StateChain).id, mainChain.id);

        const blockedJobs = yield* step(
          stateAdapter.listBlockedJobs({
            chainId: blockerChain.id,
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(blockedJobs.items, []);
        assert.deepEqual(
          yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id }),
            ),
          ),
          [],
        );

        const [deletedBlocker] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.id] }),
          ),
        );
        assert.equal((deletedBlocker as StateChain).id, blockerChain.id);
      }),
    },
    {
      name: "deletes nothing and returns the referencing blocker rows when a chain is an outside blocker",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
            }),
          ),
        );

        const [mainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          ),
        );

        const [blockerResult] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.head.chainId] }),
          ),
        );
        assert.equal(Array.isArray(blockerResult), true);
        const references = blockerResult as StateBlockedJob[];
        assert.equal(references.length, 1);
        assert.equal(references[0].jobId, mainChain.head.id);
        assert.equal(references[0].blockedByChainId, blockerChain.id);
        assert.equal(references[0].job.id, mainChain.head.id);

        const [blockerStillThere] = yield* step(
          stateAdapter.getJobs({ jobIds: [blockerChain.head.id] }),
        );
        assert.equal(blockerStillThere?.id, blockerChain.head.id);

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({
              txCtx,
              chainIds: [mainChain.head.chainId, blockerChain.head.chainId],
            }),
          ),
        );

        assert.equal(results.length, 2);
        assert.equal((results[0] as StateChain).id, mainChain.id);
        assert.equal((results[1] as StateChain).id, blockerChain.id);
      }),
    },
    {
      name: "deletes a repeated id once, reporting it at every position, and rolls back cleanly",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["delete-repeated:step"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "delete-repeated",
                  input: null,
                },
              ],
            }),
          ),
        );
        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "delete-repeated:step",
                  continueFromId: stateChain.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const continuationId = continued!.continuation.id;

        yield* step(
          assertRejects(
            () =>
              inTransaction(stateAdapter, function* (txCtx) {
                const results = yield* step(
                  stateAdapter.deleteChains({
                    txCtx,
                    chainIds: [stateChain.id, stateChain.id],
                  }),
                );
                assert.deepEqual(
                  results.map((result) => (result as StateChain).id),
                  [stateChain.id, stateChain.id],
                );
                throw new Error("rollback after deleting a repeated id");
              }),
            /rollback after deleting a repeated id/,
          ),
        );

        const runningChains = yield* step(
          stateAdapter.listChains({
            typeName: "delete-repeated",
            status: "running",
            orderBy: "createdAt",
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(
          runningChains.items.map((chain) => chain.id),
          [stateChain.id],
        );
        assert.deepEqual(
          yield* step(stateAdapter.countChainsByTypeName({ typeNames: ["delete-repeated"] })),
          [{ running: { count: 1, hasMore: false }, completed: { count: 0, hasMore: false } }],
        );
        assert.deepEqual(
          yield* step(stateAdapter.countJobsByTypeName({ typeNames: ["delete-repeated:step"] })),
          [
            {
              blocked: { count: 0, hasMore: false },
              pending: { count: 1, hasMore: false },
              running: { count: 0, hasMore: false },
              completed: { count: 0, hasMore: false },
            },
          ],
        );

        const acquired = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["delete-repeated:step"],
            limit: 2,
          }),
        );
        assert.deepEqual(
          acquired.map((job) => job.id),
          [continuationId],
        );

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [stateChain.id, stateChain.id] }),
          ),
        );
        assert.deepEqual(
          results.map((result) => (result as StateChain).id),
          [stateChain.id, stateChain.id],
        );
        assert.deepEqual(
          yield* step(stateAdapter.getJobs({ jobIds: [stateChain.id, continuationId] })),
          [undefined, undefined],
        );
      }),
    },
    {
      name: "reports undefined for a chain batched with an outside-referenced one and deletes neither",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain, mainChain, freeChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "mixed-delete-blocker",
                  input: null,
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "mixed-delete-main",
                  input: null,
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "mixed-delete-free",
                  input: null,
                },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.id] }],
            }),
          ),
        );

        const [blockerResult, freeResult] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.id, freeChain.id] }),
          ),
        );

        assert.deepEqual(
          (blockerResult as StateBlockedJob[]).map((reference) => reference.jobId),
          [mainChain.id],
        );
        assert.equal(freeResult, undefined);
        const chains = yield* step(
          stateAdapter.getChains({ chainIds: [blockerChain.id, freeChain.id] }),
        );
        assert.deepEqual(
          chains.map((chain) => chain?.id),
          [blockerChain.id, freeChain.id],
        );
      }),
    },
    {
      name: "reports undefined for a missing id and deletes the rest",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "delete-missing",
                  input: null,
                },
              ],
            }),
          ),
        );
        const missingId = stateAdapter.config.generateJobId();

        const [deleted, missing] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [stateChain.id, missingId] }),
          ),
        );

        assert.equal((deleted as StateChain).id, stateChain.id);
        assert.equal(missing, undefined);
        assert.deepEqual(yield* step(stateAdapter.getJobs({ jobIds: [stateChain.id] })), [
          undefined,
        ]);
      }),
    },
    {
      name: "reports undefined for a continuation id and deletes nothing",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "delete-continuation-id",
                  input: null,
                },
              ],
            }),
          ),
        );
        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "delete-continuation-id:step",
                  continueFromId: stateChain.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const continuationId = continued!.continuation.id;

        const [result] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [continuationId] }),
          ),
        );

        assert.equal(result, undefined);
        const jobs = yield* step(stateAdapter.getJobs({ jobIds: [stateChain.id, continuationId] }));
        assert.deepEqual(
          jobs.map((job) => job?.id),
          [stateChain.id, continuationId],
        );
      }),
    },
  ],
};

export const deleteChainsConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "deleteChains",
    cases: [
      {
        name: "sees a blocker reference committed while it waited on the head lock",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "late-reference-blocker",
                  input: null,
                },
              ],
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
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "late-reference-blocked",
                  input: null,
                },
              ],
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
          const deleteTx = Promise.resolve(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.id] }),
            ),
          ).finally(() => {
            deleteSettled = true;
          });

          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          assert.equal(deleteSettled, false);

          releaseAdder!();
          const blockedChain = await adderTx;

          const [result] = await deleteTx;
          assert.equal(Array.isArray(result), true);
          assert.deepEqual(
            (result as StateBlockedJob[]).map((ref) => ref.jobId),
            [blockedChain.head.id],
          );

          const [blockerStillThere] = await stateAdapter.getChains({ chainIds: [blockerChain.id] });
          assert.equal(blockerStillThere?.id, blockerChain.id);
        },
      },
      {
        name: "deletes a continuation committed while it waited on the head lock",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [stateChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "late-continuation",
                  input: null,
                },
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
            await stateAdapter.getJobs({ txCtx, jobIds: [stateChain.head.id], lock: "exclusive" });
            const [result] = await stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
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
          const deleteTx = Promise.resolve(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.deleteChains({ txCtx, chainIds: [stateChain.id] }),
            ),
          ).finally(() => {
            deleteSettled = true;
          });

          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          assert.equal(deleteSettled, false);

          releaseContinuer!();
          const continuation = await continuerTx;

          const [deleted] = await deleteTx;
          assert.equal((deleted as StateChain).tail?.id, continuation.id);
          assert.deepEqual(
            await stateAdapter.getJobs({ jobIds: [stateChain.head.id, continuation.id] }),
            [undefined, undefined],
          );
        },
      },
    ],
  };
