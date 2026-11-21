import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { sleep } from "@queuert/helpers/sleep";
import { dynamicSyncAsync, syncAsync, resource, step } from "@queuert/sync-async";

import { runInModeOf } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateBlockedJob, StateChain } from "../../state-adapter/state-adapter.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const deleteChainsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "deleteChains",
  cases: [
    {
      name: "deletes all jobs in the given chains",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
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
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
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
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
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
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
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
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
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
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
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
              stateAdapter.withTransaction((txCtx) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
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
                ),
              ),
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
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
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
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
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
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
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
    {
      name: "keeps blocking while a dependent remains and clears it when the last one is deleted",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain, firstDependent, secondDependent] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "dependent", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "dependent", input: null },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: firstDependent.head.id, blockedByChainIds: [blockerChain.id] },
                {
                  jobId: secondDependent.head.id,
                  blockedByChainIds: [blockerChain.id, blockerChain.id],
                },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [firstDependent.id] }),
          ),
        );
        const [stillBlocking] = yield* step(
          stateAdapter.getChains({ chainIds: [blockerChain.id] }),
        );
        assert.equal(stillBlocking!.blocking, true);

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [secondDependent.id] }),
          ),
        );
        const [cleared] = yield* step(stateAdapter.getChains({ chainIds: [blockerChain.id] }));
        assert.equal(cleared!.blocking, false);
        const [blockerHead] = yield* step(stateAdapter.getJobs({ jobIds: [blockerChain.head.id] }));
        assert.equal(blockerHead!.chain.blocking, false);
        const blockingChains = yield* step(
          stateAdapter.listChains({
            typeName: "blocker",
            blocking: true,
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(blockingChains.items, []);
        const nonBlockingChains = yield* step(
          stateAdapter.listChains({
            typeName: "blocker",
            blocking: false,
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(
          nonBlockingChains.items.map((chain) => chain.id),
          [blockerChain.id],
        );
      }),
    },
    {
      name: "clears blocking only on the chains the deleted blocker rows were the last to reference",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [onlyDeleted, sharedBlocker, deletedDependent, keptDependent] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "dependent", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "dependent", input: null },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                {
                  jobId: deletedDependent.head.id,
                  blockedByChainIds: [onlyDeleted.id, sharedBlocker.id],
                },
                { jobId: keptDependent.head.id, blockedByChainIds: [sharedBlocker.id] },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [deletedDependent.id] }),
          ),
        );
        const [onlyDeletedRead, sharedBlockerRead] = yield* step(
          stateAdapter.getChains({ chainIds: [onlyDeleted.id, sharedBlocker.id] }),
        );
        assert.equal(onlyDeletedRead!.blocking, false);
        assert.equal(sharedBlockerRead!.blocking, true);
      }),
    },
    {
      name: "clears blocking when the deleted blocker rows belong to a continuation",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain, dependentChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "dependent", input: null },
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
                  typeName: "dependent",
                  input: null,
                  continueFromId: dependentChain.head.id,
                },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: continued!.continuation.id, blockedByChainIds: [blockerChain.id] },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [dependentChain.id] }),
          ),
        );
        const [blockerRead] = yield* step(stateAdapter.getChains({ chainIds: [blockerChain.id] }));
        assert.equal(blockerRead!.blocking, false);
      }),
    },
    {
      name: "keeps blocking when the delete rolls back",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain, dependentChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "dependent", input: null },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: dependentChain.head.id, blockedByChainIds: [blockerChain.id] },
              ],
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.deleteChains({ txCtx, chainIds: [dependentChain.id] }),
                    );
                    throw new Error("Intentional rollback");
                  }),
                ),
              ),
            /Intentional rollback/,
          ),
        );

        const [blockerRead] = yield* step(stateAdapter.getChains({ chainIds: [blockerChain.id] }));
        assert.equal(blockerRead!.blocking, true);
      }),
    },
    {
      name: "returns deleted chains with blocking false, including a blocker deleted with its dependent",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain, dependentChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "dependent", input: null },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: dependentChain.head.id, blockedByChainIds: [blockerChain.id] },
              ],
            }),
          ),
        );

        const [deletedBlocker, deletedDependent] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.id, dependentChain.id] }),
          ),
        );
        assert.equal((deletedBlocker as StateChain).blocking, false);
        assert.equal((deletedDependent as StateChain).blocking, false);
      }),
    },
  ],
};

export const deleteChainsConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "deleteChains",
    cases: [
      {
        name: "concurrent deletes of a blocker chain's last dependents clear its blocking",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
            }),
          );
          const dependentChains = await stateAdapter.withTransaction(async (txCtx) => {
            const created = await stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: 6 }, () => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "dependent",
                input: null,
              })),
            });
            await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: created.map((chain) => ({
                jobId: chain.head.id,
                blockedByChainIds: [blockerChain.id],
              })),
            });
            return created;
          });

          await Promise.all(
            dependentChains.map(async (dependentChain) =>
              stateAdapter.withTransaction((txCtx) =>
                stateAdapter.deleteChains({ txCtx, chainIds: [dependentChain.id] }),
              ),
            ),
          );

          const [blockerRead] = await stateAdapter.getChains({ chainIds: [blockerChain.id] });
          assert.equal(blockerRead!.blocking, false);
        },
      },
      {
        name: "deletes racing attaches on the same blocker chain keep its blocking while a dependent remains",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
            }),
          );
          const existingDependents = await stateAdapter.withTransaction(async (txCtx) => {
            const created = await stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: 6 }, () => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "dependent",
                input: null,
              })),
            });
            await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: created.map((chain) => ({
                jobId: chain.head.id,
                blockedByChainIds: [blockerChain.id],
              })),
            });
            return created;
          });

          const [, attached] = await Promise.all([
            Promise.all(
              existingDependents.map(async (dependentChain) =>
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.deleteChains({ txCtx, chainIds: [dependentChain.id] }),
                ),
              ),
            ),
            Promise.all(
              Array.from({ length: 6 }, async () =>
                stateAdapter.withTransaction(async (txCtx) => {
                  const [created] = await stateAdapter.createJobs({
                    txCtx,
                    jobs: [
                      {
                        id: stateAdapter.config.generateJobId(),
                        typeName: "dependent",
                        input: null,
                      },
                    ],
                  });
                  await stateAdapter.addJobsBlockers({
                    txCtx,
                    jobBlockers: [{ jobId: created.head.id, blockedByChainIds: [blockerChain.id] }],
                  });
                  return created;
                }),
              ),
            ),
          ]);

          const [whileAttached] = await stateAdapter.getChains({ chainIds: [blockerChain.id] });
          assert.equal(whileAttached!.blocking, true);

          await Promise.all(
            attached.map(async (dependentChain) =>
              stateAdapter.withTransaction((txCtx) =>
                stateAdapter.deleteChains({ txCtx, chainIds: [dependentChain.id] }),
              ),
            ),
          );
          const [afterAll] = await stateAdapter.getChains({ chainIds: [blockerChain.id] });
          assert.equal(afterAll!.blocking, false);
        },
      },
      {
        name: "deleting dependents while their blocker chain completes neither deadlocks nor strands the rest",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
            }),
          );
          const dependentChains = await stateAdapter.withTransaction(async (txCtx) => {
            const created = await stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: 6 }, () => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "dependent",
                input: null,
              })),
            });
            await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: created.map((chain) => ({
                jobId: chain.head.id,
                blockedByChainIds: [blockerChain.id],
              })),
            });
            return created;
          });
          const deletedChains = dependentChains.slice(0, 3);
          const keptChains = dependentChains.slice(3);

          await Promise.all([
            ...deletedChains.map(async (dependentChain) =>
              stateAdapter.withTransaction((txCtx) =>
                stateAdapter.deleteChains({ txCtx, chainIds: [dependentChain.id] }),
              ),
            ),
            stateAdapter.withTransaction(async (txCtx) => {
              const [completed] = await stateAdapter.completeJobs({
                txCtx,
                jobs: [{ jobId: blockerChain.head.id, output: null }],
              });
              if (completed!.chain.blocking) {
                await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id });
              }
            }),
          ]);

          const kept = await stateAdapter.getJobs({
            jobIds: keptChains.map((chain) => chain.head.id),
          });
          assert.deepEqual(
            kept.map((job) => job!.status),
            keptChains.map(() => "pending"),
          );
          const [blockerRead] = await stateAdapter.getChains({ chainIds: [blockerChain.id] });
          assert.equal(blockerRead!.blocking, true);
        },
      },
      {
        name: "concurrent deletes of chains that block each other across the calls do not deadlock",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          await Promise.all(
            Array.from({ length: 10 }, async () => {
              const [rootChain, middleChain, leafChain] = await stateAdapter.withTransaction(
                (txCtx) =>
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: ["root", "middle", "leaf"].map((typeName) => ({
                      id: stateAdapter.config.generateJobId(),
                      typeName,
                      input: null,
                    })),
                  }),
              );
              await stateAdapter.withTransaction((txCtx) =>
                stateAdapter.addJobsBlockers({
                  txCtx,
                  jobBlockers: [
                    { jobId: middleChain.head.id, blockedByChainIds: [rootChain.id] },
                    { jobId: leafChain.head.id, blockedByChainIds: [middleChain.id] },
                  ],
                }),
              );

              const [leafAndRoot, middle] = await Promise.all([
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.deleteChains({ txCtx, chainIds: [leafChain.id, rootChain.id] }),
                ),
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.deleteChains({ txCtx, chainIds: [middleChain.id] }),
                ),
              ]);
              assert.equal(Array.isArray(leafAndRoot[1]), true);
              assert.equal(Array.isArray(middle[0]), true);
            }),
          );
        },
      },
      {
        name: "concurrent deletes and completions across a blocker graph neither deadlock nor leave blocking stale",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const rounds = await Promise.allSettled(
            Array.from({ length: 6 }, async () => {
              const [rootChain, middleChain, leafChain, fanChain, otherFanChain] =
                await stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.createJobs({
                    txCtx,
                    jobs: ["root", "middle", "leaf", "fan", "fan"].map((typeName) => ({
                      id: stateAdapter.config.generateJobId(),
                      typeName,
                      input: null,
                    })),
                  }),
                );
              await stateAdapter.withTransaction((txCtx) =>
                stateAdapter.addJobsBlockers({
                  txCtx,
                  jobBlockers: [
                    { jobId: middleChain.head.id, blockedByChainIds: [rootChain.id] },
                    { jobId: leafChain.head.id, blockedByChainIds: [middleChain.id, rootChain.id] },
                    { jobId: fanChain.head.id, blockedByChainIds: [rootChain.id] },
                    { jobId: otherFanChain.head.id, blockedByChainIds: [middleChain.id] },
                  ],
                }),
              );

              const settled = await Promise.allSettled([
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.deleteChains({ txCtx, chainIds: [leafChain.id] }),
                ),
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.deleteChains({ txCtx, chainIds: [fanChain.id, otherFanChain.id] }),
                ),
                stateAdapter.withTransaction((txCtx) =>
                  stateAdapter.deleteChains({
                    txCtx,
                    chainIds: [middleChain.id, otherFanChain.id],
                  }),
                ),
                stateAdapter.withTransaction(async (txCtx) => {
                  const [completed] = await stateAdapter.completeJobs({
                    txCtx,
                    jobs: [{ jobId: rootChain.head.id, output: null }],
                  });
                  if (completed!.chain.blocking) {
                    await stateAdapter.unblockJobs({ txCtx, blockedByChainId: rootChain.id });
                  }
                }),
              ]);
              for (const outcome of settled) {
                if (outcome.status === "rejected") throw outcome.reason;
              }
              return [rootChain, middleChain, leafChain, fanChain, otherFanChain];
            }),
          );
          for (const outcome of rounds) {
            if (outcome.status === "rejected") throw outcome.reason;
            const remaining = (
              await stateAdapter.getChains({ chainIds: outcome.value.map((chain) => chain.id) })
            ).filter((chain) => chain !== undefined);
            for (const chain of remaining) {
              const blockedJobs = await stateAdapter.listBlockedJobs({
                chainId: chain.id,
                orderDirection: "asc",
                page: { limit: 10 },
              });
              assert.equal(chain.blocking, blockedJobs.items.length > 0, chain.typeName);
            }
          }
        },
      },
    ],
  };

export const deleteChainsConcurrentTransactionsLockWaitGroup: ConformanceGroup<StateAdapterConformanceContext> =
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

          const { promise: blockerAdded, resolve: signalBlockerAdded } =
            Promise.withResolvers<void>();
          const { promise: adderGate, resolve: releaseAdder } = Promise.withResolvers<void>();

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
            signalBlockerAdded();
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

          try {
            await sleep(LOCK_BLOCK_OBSERVATION_MS);
            assert.equal(deleteSettled, false);
          } finally {
            releaseAdder();
          }
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

          const { promise: continued, resolve: signalContinued } = Promise.withResolvers<void>();
          const { promise: continuerGate, resolve: releaseContinuer } =
            Promise.withResolvers<void>();

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
            signalContinued();
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

          try {
            await sleep(LOCK_BLOCK_OBSERVATION_MS);
            assert.equal(deleteSettled, false);
          } finally {
            releaseContinuer();
          }
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
