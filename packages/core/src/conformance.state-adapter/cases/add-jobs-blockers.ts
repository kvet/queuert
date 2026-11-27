import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { sleep } from "@queuert/helpers/sleep";
import { dynamicSyncAsync, syncAsync, resource, step } from "@queuert/sync-async";

import { runInModeOf } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const addJobsBlockersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "addJobsBlockers",
  cases: [
    {
      name: "adds blockers and reports the blocker chain as incomplete",
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

        const [result] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          ),
        );

        assert.equal(result.completedAt, null);
        assert.equal(result.attemptAt, null);
        assert.equal(result.status, "blocked");
        assert.equal(result.blockers.length, 1);
        assert.equal(result.blockers[0]!.id, blockerChain.head.chainId);
        assert.equal(result.blockers[0]!.completedAt, null);
      }),
    },
    {
      name: "reports a completed blocker chain and leaves the job unblocked",
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

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerChain.head.id, output: null }],
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

        const [result] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          ),
        );

        assert.equal(result.completedAt, null);
        assert.equal(result.attemptAt, null);
        assert.equal(result.status, "pending");
        assert.equal(result.blockers.length, 1);
        assert.ok(result.blockers[0]!.completedAt instanceof Date);
      }),
    },
    {
      name: "reports an undefined blocker for an unknown blocker chain",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [mainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
            }),
          ),
        );

        const missingChainId =
          mainChain.head.chainId.slice(0, -1) + (mainChain.head.chainId.endsWith("0") ? "1" : "0");

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    const [result] = yield* step(
                      stateAdapter.addJobsBlockers({
                        txCtx,
                        jobBlockers: [
                          { jobId: mainChain.head.id, blockedByChainIds: [missingChainId] },
                        ],
                      }),
                    );
                    assert.equal(result.blockers.length, 1);
                    assert.equal(result.blockers[0], undefined);
                    throw new Error("caller aborts");
                  }),
                ),
              ),
            /caller aborts/,
          ),
        );

        const [unchanged] = yield* step(stateAdapter.getJobs({ jobIds: [mainChain.head.id] }));
        assert.equal(unchanged!.status, "pending");
        assert.equal(
          (yield* step(stateAdapter.getJobsBlockers({ jobIds: [mainChain.head.id] })))[0].length,
          0,
        );
      }),
    },
    {
      name: "adds blockers to multiple jobs in a single batch",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain1, blockerChain2] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null },
              ],
            }),
          ),
        );

        const [mainChain1, mainChain2] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              ],
            }),
          ),
        );

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) =>
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
          ),
        );

        assert.equal(results.length, 2);
        assert.equal(results[0].id, mainChain1.head.id);
        assert.equal(results[0].completedAt, null);
        assert.equal(results[0].attemptAt, null);
        assert.equal(results[0].status, "blocked");
        assert.deepEqual(
          results[0].blockers.map((blocker) => blocker!.id),
          [blockerChain1.head.chainId],
        );

        assert.equal(results[1].id, mainChain2.head.id);
        assert.equal(results[1].completedAt, null);
        assert.equal(results[1].attemptAt, null);
        assert.equal(results[1].status, "blocked");
        assert.deepEqual(
          results[1].blockers.map((blocker) => blocker!.id),
          [blockerChain1.head.chainId, blockerChain2.head.chainId],
        );
      }),
    },
    {
      name: "batch handles mix of blocked and unblocked jobs",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [completedBlockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: completedBlockerChain.head.id, output: null }],
            }),
          ),
        );

        const [incompleteBlockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
            }),
          ),
        );

        const [mainChain1, mainChain2] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              ],
            }),
          ),
        );

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) =>
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
          ),
        );

        assert.equal(results.length, 2);
        assert.equal(results[0].id, mainChain1.head.id);
        assert.equal(results[0].completedAt, null);
        assert.equal(results[0].attemptAt, null);
        assert.equal(results[0].status, "pending");
        assert.ok(results[0].blockers[0]!.completedAt instanceof Date);

        assert.equal(results[1].id, mainChain2.head.id);
        assert.equal(results[1].completedAt, null);
        assert.equal(results[1].attemptAt, null);
        assert.equal(results[1].status, "blocked");
        assert.equal(results[1].blockers[0]!.id, incompleteBlockerChain.head.chainId);
        assert.equal(results[1].blockers[0]!.completedAt, null);
      }),
    },
    {
      name: "returns the blocker chain's own trace context",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const blockerChainTraceContext = "00-test123-chain456-01";
        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "blocker",
                  input: null,
                  chainTraceContext: blockerChainTraceContext,
                },
              ],
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

        const [result] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          ),
        );

        assert.equal(result.blockers.length, 1);
        assert.deepEqual(result.blockers[0]!.traceContext, blockerChainTraceContext);
      }),
    },
    {
      name: "returns blockers in the same order as blockedByChainIds",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const chainTraceA = "00-aaa111-chain-aaa-01";
        const chainTraceB = "00-bbb222-chain-bbb-01";

        const [blockerChainA] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "blockerA",
                  input: null,
                  chainTraceContext: chainTraceA,
                },
              ],
            }),
          ),
        );

        const [blockerChainB] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "blockerB",
                  input: null,
                  chainTraceContext: chainTraceB,
                },
              ],
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

        const [result] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                {
                  jobId: mainChain.head.id,
                  blockedByChainIds: [blockerChainA.head.chainId, blockerChainB.head.chainId],
                },
              ],
            }),
          ),
        );

        assert.equal(result.blockers.length, 2);
        assert.deepEqual(result.blockers[0]!.traceContext, chainTraceA);
        assert.deepEqual(result.blockers[1]!.traceContext, chainTraceB);
      }),
    },
    {
      name: "reports an undefined blocker for a continuation job id",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
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
                  typeName: "blocker",
                  input: null,
                  continueFromId: headChain.head.id,
                },
              ],
            }),
          ),
        );
        const { continuation } = continued!;

        const [mainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "main", input: null }],
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
                    const [result] = yield* step(
                      stateAdapter.addJobsBlockers({
                        txCtx,
                        jobBlockers: [
                          { jobId: mainChain.head.id, blockedByChainIds: [continuation.id] },
                        ],
                      }),
                    );
                    assert.equal(result.blockers[0], undefined);
                    throw new Error("caller aborts");
                  }),
                ),
              ),
            /caller aborts/,
          ),
        );

        const [after] = yield* step(stateAdapter.getJobs({ jobIds: [mainChain.head.id] }));
        assert.equal(after!.status, "pending");
        assert.equal(
          (yield* step(stateAdapter.getJobsBlockers({ jobIds: [mainChain.head.id] })))[0].length,
          0,
        );
      }),
    },
    {
      name: "duplicate blocker chain ids do not break addJobsBlockers",
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

        const [result] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
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
          ),
        );

        assert.equal(result.status, "blocked");
        assert.deepEqual(
          result.blockers.map((blocker) => blocker!.id),
          [blockerChain.head.chainId, blockerChain.head.chainId, blockerChain.head.chainId],
        );
      }),
    },
    {
      name: "sets blocking on each blocker chain, and every chain read reports it",
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
        assert.equal(blockerChain.blocking, false);

        const [attached] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: dependentChain.head.id, blockedByChainIds: [blockerChain.id] },
              ],
            }),
          ),
        );
        assert.equal(attached.blockers[0]!.blocking, true);
        assert.equal(attached.chain.blocking, false);

        const [blockerRead, dependentRead] = yield* step(
          stateAdapter.getChains({ chainIds: [blockerChain.id, dependentChain.id] }),
        );
        assert.equal(blockerRead!.blocking, true);
        assert.equal(dependentRead!.blocking, false);
        const [blockerHead] = yield* step(stateAdapter.getJobs({ jobIds: [blockerChain.head.id] }));
        assert.equal(blockerHead!.chain.blocking, true);
        const blockingChains = yield* step(
          stateAdapter.listChains({
            typeName: "blocker",
            blocking: true,
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(
          blockingChains.items.map((chain) => chain.id),
          [blockerChain.id],
        );
        const nonBlockingChains = yield* step(
          stateAdapter.listChains({
            typeName: "dependent",
            blocking: false,
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(
          nonBlockingChains.items.map((chain) => chain.id),
          [dependentChain.id],
        );
      }),
    },
    {
      name: "leaves blocking false when the attach rolls back",
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
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    yield* step(
                      stateAdapter.addJobsBlockers({
                        txCtx,
                        jobBlockers: [
                          { jobId: dependentChain.head.id, blockedByChainIds: [blockerChain.id] },
                        ],
                      }),
                    );
                    throw new Error("Intentional rollback");
                  }),
                ),
              ),
            /Intentional rollback/,
          ),
        );

        const [blockerRead] = yield* step(stateAdapter.getChains({ chainIds: [blockerChain.id] }));
        assert.equal(blockerRead!.blocking, false);
      }),
    },
    {
      name: "reports blocking on a job whose own chain becomes a blocker in the same call",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [upstreamChain, middleChain, downstreamChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "upstream", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "middle", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "downstream", input: null },
              ],
            }),
          ),
        );

        const [middle, downstream] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: middleChain.head.id, blockedByChainIds: [upstreamChain.id] },
                { jobId: downstreamChain.head.id, blockedByChainIds: [middleChain.id] },
              ],
            }),
          ),
        );
        assert.equal(middle.chain.blocking, true);
        assert.equal(middle.blockers[0]!.blocking, true);
        assert.equal(downstream.chain.blocking, false);
        assert.equal(downstream.blockers[0]!.blocking, true);
      }),
    },
  ],
};

export const addJobsBlockersConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "addJobsBlockers",
    cases: [
      {
        name: "leaves no dependent blocked when the completion of its blocker races an attach that holds the blocker",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain, mainChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "attached-blocker",
                  input: null,
                },
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              ],
            }),
          );

          const { promise: attached, resolve: signalAttached } = Promise.withResolvers<void>();
          const { promise: attacherGate, resolve: releaseAttacher } = Promise.withResolvers<void>();

          const addTx = stateAdapter.withTransaction(async (txCtx) => {
            const result = await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
            });
            signalAttached();
            await attacherGate;
            return result;
          });

          await attached;

          const completerTx = Promise.resolve(
            stateAdapter.withTransaction(async (txCtx) => {
              const [completedBlocker] = await stateAdapter.completeJobs({
                txCtx,
                jobs: [{ jobId: blockerChain.head.id, output: null }],
              });
              const dependents = completedBlocker!.chain.blocking
                ? await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id })
                : [];
              return { completedBlocker: completedBlocker!, dependents };
            }),
          );

          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          releaseAttacher();
          await addTx;
          const { completedBlocker, dependents } = await completerTx;

          const [dependent] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
          assert.equal(dependent!.status, "pending");
          if (completedBlocker.chain.blocking) {
            assert.deepEqual(
              dependents.map((entry) => entry.job.status),
              ["pending"],
            );
          }
        },
      },
      {
        name: "concurrent attaches and completions of shared blocker chains leave no dependent blocked",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const blockerChains = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: 4 }, () => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "fan-in-blocker",
                input: null,
              })),
            }),
          );
          const dependentIds = Array.from({ length: 12 }, () =>
            stateAdapter.config.generateJobId(),
          );

          await Promise.all([
            ...dependentIds.map(async (dependentId, index) =>
              stateAdapter.withTransaction(async (txCtx) => {
                await stateAdapter.createJobs({
                  txCtx,
                  jobs: [{ id: dependentId, typeName: "fan-in-dependent", input: null }],
                });
                const blockedByChainIds = [0, 1, 2].map(
                  (offset) => blockerChains[(index + offset) % blockerChains.length].id,
                );
                await stateAdapter.addJobsBlockers({
                  txCtx,
                  jobBlockers: [
                    {
                      jobId: dependentId,
                      blockedByChainIds:
                        index % 2 === 0 ? blockedByChainIds : blockedByChainIds.toReversed(),
                    },
                  ],
                });
              }),
            ),
            ...blockerChains.map(async (blockerChain) =>
              stateAdapter.withTransaction(async (txCtx) => {
                await stateAdapter.completeJobs({
                  txCtx,
                  jobs: [{ jobId: blockerChain.head.id, output: null }],
                });
                await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id });
              }),
            ),
          ]);

          const dependents = await stateAdapter.getJobs({ jobIds: dependentIds });
          assert.deepEqual(
            dependents.map((dependent) => dependent!.status),
            dependentIds.map(() => "pending"),
          );
        },
      },
    ],
  };

export const addJobsBlockersConcurrentTransactionsTwoConnectionGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "addJobsBlockers",
    cases: [
      {
        name: "reports a blocker chain completed after the transaction's first read as complete",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "late-completed-blocker",
                  input: null,
                },
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              ],
            }),
          );

          const firstRead = Promise.withResolvers<void>();
          const completerDone = Promise.withResolvers<void>();
          const addTx = stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.getChains({ txCtx, chainIds: [blockerChain.id] });
            firstRead.resolve();
            await completerDone.promise;
            return stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
            });
          });
          await firstRead.promise;

          try {
            await stateAdapter.withTransaction(async (txCtx) => {
              await stateAdapter.completeJobs({
                txCtx,
                jobs: [{ jobId: blockerChain.head.id, output: null }],
              });
              await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id });
            });
          } finally {
            completerDone.resolve();
          }

          const [added] = await addTx;
          assert.equal(added.status, "pending");
          assert.deepEqual(
            added.blockers.map((blocker) => blocker?.status),
            ["completed"],
          );
          const [stored] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
          assert.equal(stored!.status, "pending");
        },
      },
    ],
  };

export const addJobsBlockersConcurrentTransactionsLockWaitGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "addJobsBlockers",
    cases: [
      {
        name: "reports a blocker chain deleted while it waited on the head lock as missing",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain, mainChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "deleted-blocker",
                  input: null,
                },
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              ],
            }),
          );

          const { promise: deleted, resolve: signalDeleted } = Promise.withResolvers<void>();
          const { promise: deleterGate, resolve: releaseDeleter } = Promise.withResolvers<void>();

          const deleteTx = stateAdapter.withTransaction(async (txCtx) => {
            const result = await stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.id] });
            signalDeleted();
            await deleterGate;
            return result;
          });

          await deleted;

          let addSettled = false;
          const addTx = Promise.resolve(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
              }),
            ),
          ).finally(() => {
            addSettled = true;
          });

          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          assert.equal(addSettled, false);

          releaseDeleter();
          const [deletedChain] = await deleteTx;
          assert.equal(deletedChain!.id, blockerChain.id);

          const [added] = await addTx;
          assert.deepEqual(added.blockers, [undefined]);
          assert.equal(added.status, "pending");
          const blockedJobs = await stateAdapter.listBlockedJobs({
            chainId: blockerChain.id,
            orderDirection: "asc",
            page: { limit: 10 },
          });
          assert.deepEqual(blockedJobs.items, []);
        },
      },
      {
        name: "reports a blocker chain continued while it waited on the head lock as incomplete",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain, mainChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continued-blocker",
                  input: null,
                },
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              ],
            }),
          );

          const { promise: continued, resolve: signalContinued } = Promise.withResolvers<void>();
          const { promise: continuerGate, resolve: releaseContinuer } =
            Promise.withResolvers<void>();

          const continuerTx = stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.getJobs({
              txCtx,
              jobIds: [blockerChain.head.id],
              lock: "exclusive",
            });
            await stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continued-blocker:step",
                  input: null,
                  continueFromId: blockerChain.head.id,
                },
              ],
            });
            signalContinued();
            await continuerGate;
          });

          await continued;

          let addSettled = false;
          const addTx = Promise.resolve(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
              }),
            ),
          ).finally(() => {
            addSettled = true;
          });

          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          assert.equal(addSettled, false);

          releaseContinuer();
          await continuerTx;

          const [added] = await addTx;
          assert.equal(added.status, "blocked");
          assert.deepEqual(
            added.blockers.map((blocker) => blocker?.status),
            ["running"],
          );
        },
      },
      {
        name: "reports a blocker chain completed while it waited on the head lock as complete",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain, mainChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "completed-blocker",
                  input: null,
                },
                { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
              ],
            }),
          );

          const { promise: completed, resolve: signalCompleted } = Promise.withResolvers<void>();
          const { promise: completerGate, resolve: releaseCompleter } =
            Promise.withResolvers<void>();

          const completerTx = stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.getJobs({
              txCtx,
              jobIds: [blockerChain.head.id],
              lock: "exclusive",
            });
            await stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerChain.head.id, output: null }],
            });
            signalCompleted();
            await completerGate;
          });

          await completed;

          let addSettled = false;
          const addTx = Promise.resolve(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
              }),
            ),
          ).finally(() => {
            addSettled = true;
          });

          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          assert.equal(addSettled, false);

          releaseCompleter();
          await completerTx;

          const [added] = await addTx;
          assert.equal(added.status, "pending");
          assert.deepEqual(
            added.blockers.map((blocker) => blocker?.status),
            ["completed"],
          );
        },
      },
    ],
  };
