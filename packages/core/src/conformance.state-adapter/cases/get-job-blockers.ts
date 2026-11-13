import assert from "node:assert/strict";

import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const getJobBlockersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getJobBlockers",
  cases: [
    {
      name: "returns blocker chain views for a job",
      run: caseBody(function* ({ createStateAdapter }) {
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

        const blockers = yield* step(stateAdapter.getJobBlockers({ jobId: mainChain.head.id }));
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
      run: caseBody(function* ({ createStateAdapter }) {
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

        const blockers = yield* step(stateAdapter.getJobBlockers({ jobId: mainChain.head.id }));
        assert.equal(blockers.length, 1);

        const { head: headJob, tail: tailJob } = blockers[0];
        assert.equal(headJob.id, blockerHeadChain.head.id);
        assert.notEqual(tailJob, undefined);
        assert.equal(tailJob!.id, blockerContinuation.id);
      }),
    },
    {
      name: "returns one entry per position when the same chain is listed twice",
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
              jobBlockers: [
                {
                  jobId: mainChain.head.id,
                  blockedByChainIds: [blockerChain.id, blockerChain.id],
                },
              ],
            }),
          ),
        );

        const blockers = yield* step(stateAdapter.getJobBlockers({ jobId: mainChain.head.id }));
        assert.deepEqual(
          blockers.map(({ id }) => id),
          [blockerChain.id, blockerChain.id],
        );
      }),
    },
    {
      name: "returns empty array for job with no blockers",
      run: caseBody(function* ({ createStateAdapter }) {
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

        const blockers = yield* step(stateAdapter.getJobBlockers({ jobId: stateChain.head.id }));
        assert.equal(blockers.length, 0);
      }),
    },
  ],
};

export const getJobBlockersConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "getJobBlockers",
    cases: [
      {
        name: "non-transactional getJobBlockers does not observe an uncommitted blocker insert",
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

          let release: (() => void) | undefined;
          const gate = new Promise<void>((r) => {
            release = r;
          });
          let signalTxReady: (() => void) | undefined;
          const txReady = new Promise<void>((r) => {
            signalTxReady = r;
          });

          const txPromise = stateAdapter
            .withTransaction(async (txCtx) => {
              await stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [
                  { jobId: targetChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
                ],
              });
              signalTxReady!();
              await gate;
              throw new Error("rollback");
            })
            .catch(() => {});

          await txReady;
          const blockersPromise = stateAdapter.getJobBlockers({ jobId: targetChain.head.id });
          const targetReadPromise = stateAdapter.getJobs({ jobIds: [targetChain.head.id] });
          release!();
          await txPromise;

          const observedBlockers = await blockersPromise;
          const [observedTarget] = await targetReadPromise;
          assert.equal(observedBlockers.length, 0);
          assert.equal(observedTarget?.completedAt, null);
          assert.equal(observedTarget?.attemptAt, null);
        },
      },
    ],
  };
