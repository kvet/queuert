import assert from "node:assert/strict";

import { dynamicSyncAsync, resource, step } from "@queuert/sync-async";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const getJobsBlockersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getJobsBlockers",
  cases: [
    {
      name: "returns blocker chain views for a job",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChainA] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
            }),
          ),
        );

        const [blockerChainB] = yield* step(
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
                {
                  jobId: mainChain.head.id,
                  blockedByChainIds: [blockerChainA.head.chainId, blockerChainB.head.chainId],
                },
              ],
            }),
          ),
        );

        const [blockers] = yield* step(
          stateAdapter.getJobsBlockers({ jobIds: [mainChain.head.id] }),
        );
        assert.equal(blockers.length, 2);

        const blockerHeadIds = blockers.map(({ head }) => head.id);
        assert.ok(blockerHeadIds.includes(blockerChainA.head.id));
        assert.ok(blockerHeadIds.includes(blockerChainB.head.id));

        for (const { tail } of blockers) {
          assert.equal(tail, undefined);
        }
      }),
    },
    {
      name: "returns head and tail for a multi-job blocker chain",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerHeadChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocker-head", input: null },
              ],
            }),
          ),
        );

        const [continuedBlockerContinuation] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "blocker-step2",
                  continueFromId: blockerHeadChain.head.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const { continuation: blockerContinuation } = continuedBlockerContinuation!;

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
                { jobId: mainChain.head.id, blockedByChainIds: [blockerHeadChain.head.chainId] },
              ],
            }),
          ),
        );

        const [blockers] = yield* step(
          stateAdapter.getJobsBlockers({ jobIds: [mainChain.head.id] }),
        );
        assert.equal(blockers.length, 1);

        const { head: headJob, tail: tailJob } = blockers[0];
        assert.equal(headJob.id, blockerHeadChain.head.id);
        assert.notEqual(tailJob, undefined);
        assert.equal(tailJob!.id, blockerContinuation.id);
      }),
    },
    {
      name: "returns one entry per position when the same chain is listed twice",
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
              jobBlockers: [
                {
                  jobId: mainChain.head.id,
                  blockedByChainIds: [blockerChain.id, blockerChain.id],
                },
              ],
            }),
          ),
        );

        const [blockers] = yield* step(
          stateAdapter.getJobsBlockers({ jobIds: [mainChain.head.id] }),
        );
        assert.deepEqual(
          blockers.map(({ id }) => id),
          [blockerChain.id, blockerChain.id],
        );
      }),
    },
    {
      name: "returns empty array for job with no blockers",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "no-blockers", input: null },
              ],
            }),
          ),
        );

        const [blockers] = yield* step(
          stateAdapter.getJobsBlockers({ jobIds: [stateChain.head.id] }),
        );
        assert.equal(blockers.length, 0);
      }),
    },
    {
      name: "returns each job's blockers in the order of jobIds, none for an unknown job",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChainA, blockerChainB, firstChain, secondChain, unblockedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: ["blocker", "blocker", "first", "second", "unblocked"].map((typeName) => ({
                id: stateAdapter.config.generateJobId(),
                typeName,
                input: null,
              })),
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: firstChain.head.id, blockedByChainIds: [blockerChainA.id] },
                {
                  jobId: secondChain.head.id,
                  blockedByChainIds: [blockerChainB.id, blockerChainA.id],
                },
              ],
            }),
          ),
        );

        const jobsBlockers = yield* step(
          stateAdapter.getJobsBlockers({
            jobIds: [
              secondChain.head.id,
              stateAdapter.config.generateJobId(),
              unblockedChain.head.id,
              firstChain.head.id,
            ],
          }),
        );
        assert.deepEqual(
          jobsBlockers.map((blockers) => blockers.map(({ id }) => id)),
          [[blockerChainB.id, blockerChainA.id], [], [], [blockerChainA.id]],
        );
      }),
    },
    {
      name: "returns nothing for no jobIds and the same blockers for a repeated id",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain, blockedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: ["blocker", "blocked"].map((typeName) => ({
                id: stateAdapter.config.generateJobId(),
                typeName,
                input: null,
              })),
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: blockedChain.head.id, blockedByChainIds: [blockerChain.id] }],
            }),
          ),
        );

        assert.deepEqual(yield* step(stateAdapter.getJobsBlockers({ jobIds: [] })), []);
        const jobsBlockers = yield* step(
          stateAdapter.getJobsBlockers({ jobIds: [blockedChain.head.id, blockedChain.head.id] }),
        );
        assert.deepEqual(
          jobsBlockers.map((blockers) => blockers.map(({ id }) => id)),
          [[blockerChain.id], [blockerChain.id]],
        );
      }),
    },
  ],
};

export const getJobsBlockersConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "getJobsBlockers",
    cases: [
      {
        name: "non-transactional getJobsBlockers does not observe an uncommitted blocker insert",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "iso-blocker-src",
                  input: null,
                },
              ],
            }),
          );
          const [targetChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "iso-blocker-target",
                  input: null,
                },
              ],
            }),
          );

          const { promise: gate, resolve: release } = Promise.withResolvers<void>();
          const { promise: txReady, resolve: signalTxReady } = Promise.withResolvers<void>();

          const txPromise = stateAdapter
            .withTransaction(async (txCtx) => {
              await stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [
                  { jobId: targetChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
                ],
              });
              signalTxReady();
              await gate;
              throw new Error("rollback");
            })
            .catch(() => {});

          await txReady;
          const blockersPromise = stateAdapter.getJobsBlockers({ jobIds: [targetChain.head.id] });
          const targetReadPromise = stateAdapter.getJobs({ jobIds: [targetChain.head.id] });
          release();
          await txPromise;

          const [observedBlockers] = await blockersPromise;
          const [observedTarget] = await targetReadPromise;
          assert.equal(observedBlockers.length, 0);
          assert.equal(observedTarget?.completedAt, null);
          assert.equal(observedTarget?.attemptAt, null);
        },
      },
    ],
  };
