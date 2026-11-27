import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";
import { dynamicSyncAsync, resource, step, syncAsync, wait } from "@queuert/sync-async";

import { runInModeOf } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const unblockJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "unblockJobs",
  cases: [
    {
      name: "schedules blocked jobs when all blockers complete",
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

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerChain.head.id, output: null }],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.unblockJobs({
              txCtx,
              blockedByChainId: blockerChain.head.chainId,
            }),
          ),
        );

        assert.equal(result.length, 1);
        assert.equal(result[0].job.id, mainChain.head.id);
        assert.equal(result[0].job.status, "pending");
        assert.equal(result[0].job.completedAt, null);
        assert.equal(result[0].job.attemptAt, null);
      }),
    },
    {
      name: "returns each dependent job with its own chain",
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

        const continuation = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const [continued] = yield* step(
                  stateAdapter.continueJobs({
                    txCtx,
                    jobs: [
                      {
                        id: stateAdapter.config.generateJobId(),
                        typeName: "main:step",
                        continueFromId: mainChain.id,
                        input: null,
                      },
                    ],
                  }),
                );
                yield* step(
                  stateAdapter.addJobsBlockers({
                    txCtx,
                    jobBlockers: [
                      { jobId: continued!.continuation.id, blockedByChainIds: [blockerChain.id] },
                    ],
                  }),
                );
                return continued!.continuation;
              }),
            ),
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

        const result = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id }),
          ),
        );

        assert.equal(result.length, 1);
        assert.equal(result[0].job.id, continuation.id);
        assert.equal(result[0].job.status, "pending");
        assert.equal(result[0].job.chain.id, mainChain.id);
        assert.equal(result[0].job.chain.typeName, "main");
        assert.equal(result[0].job.chain.status, "running");
      }),
    },
    {
      name: "does not schedule job when not all blockers are complete",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerAChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
            }),
          ),
        );

        const [blockerBChain] = yield* step(
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
                  blockedByChainIds: [blockerAChain.head.chainId, blockerBChain.head.chainId],
                },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerAChain.head.id, output: null }],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.unblockJobs({
              txCtx,
              blockedByChainId: blockerAChain.head.chainId,
            }),
          ),
        );

        assert.equal(result.length, 1);
        assert.equal(result[0].jobId, mainChain.head.id);
        assert.equal(result[0].job.status, "blocked");

        const [stillBlocked] = yield* step(stateAdapter.getJobs({ jobIds: [mainChain.head.id] }));
        assert.equal(stillBlocked?.completedAt, null);
        assert.equal(stillBlocked?.attemptAt, null);
        assert.equal(stillBlocked?.status, "blocked");
      }),
    },
    {
      name: "unblocks a dependent that lists one blocker chain at two positions when that chain completes",
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
                { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id, blockerChain.id] },
              ],
            }),
          ),
        );

        const [completed] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerChain.head.id, output: null }],
            }),
          ),
        );
        assert.equal(completed!.chain.blocking, true);

        const result = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id }),
          ),
        );

        assert.deepEqual(
          result
            .toSorted((left, right) => left.index - right.index)
            .map((entry) => [entry.jobId, entry.index, entry.job.status]),
          [
            [mainChain.head.id, 0, "pending"],
            [mainChain.head.id, 1, "pending"],
          ],
        );
        const [stored] = yield* step(stateAdapter.getJobs({ jobIds: [mainChain.head.id] }));
        assert.equal(stored!.status, "pending");
      }),
    },
    {
      name: "keeps a dependent of three blockers blocked until the last one completes, in any order",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        for (const completionOrder of [
          [0, 1, 2],
          [2, 0, 1],
          [1, 2, 0],
        ]) {
          const [mainChain, ...blockerChains] = yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [
                  { id: stateAdapter.config.generateJobId(), typeName: "main", input: null },
                  ...[0, 1, 2].map(() => ({
                    id: stateAdapter.config.generateJobId(),
                    typeName: "blocker",
                    input: null,
                  })),
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
                    blockedByChainIds: blockerChains.map((blockerChain) => blockerChain.id),
                  },
                ],
              }),
            ),
          );

          const statuses: string[] = [];
          for (const blockerIndex of completionOrder) {
            const blockerChain = blockerChains[blockerIndex];
            const result = yield* step(
              stateAdapter.withTransaction((txCtx) =>
                runInModeOf(
                  stateAdapter,
                  syncAsync(function* () {
                    const [completed] = yield* step(
                      stateAdapter.completeJobs({
                        txCtx,
                        jobs: [{ jobId: blockerChain.head.id, output: null }],
                      }),
                    );
                    assert.equal(completed!.chain.blocking, true);
                    return yield* step(
                      stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id }),
                    );
                  }),
                ),
              ),
            );
            assert.deepEqual(
              result.map((entry) => [entry.jobId, entry.index]),
              [[mainChain.head.id, blockerIndex]],
            );
            const [stored] = yield* step(stateAdapter.getJobs({ jobIds: [mainChain.head.id] }));
            statuses.push(stored!.status);
          }

          assert.deepEqual(statuses, ["blocked", "blocked", "pending"]);
        }
      }),
    },
    {
      name: "returns empty array when no blocked jobs exist for chain ID",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "standalone", input: null },
              ],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.unblockJobs({
              txCtx,
              blockedByChainId: stateChain.head.chainId,
            }),
          ),
        );

        assert.equal(result.length, 0);
      }),
    },
    {
      name: "returns the stored blocker rows for a blocker chain",
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

        const traceContext = "00-test-span-123-01";

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
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
          ),
        );

        const result = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.unblockJobs({
              txCtx,
              blockedByChainId: blockerChain.head.chainId,
            }),
          ),
        );

        assert.equal(result.length, 1);
        assert.equal(result[0].jobId, mainChain.head.id);
        assert.equal(result[0].blockedByChainId, blockerChain.head.chainId);
        assert.equal(result[0].index, 0);
        assert.deepEqual(result[0].traceContext, traceContext);
      }),
    },
    {
      name: "returns no blocker rows when nothing references the chain",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "standalone", input: null },
              ],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.unblockJobs({
              txCtx,
              blockedByChainId: stateChain.head.chainId,
            }),
          ),
        );

        assert.equal(result.length, 0);
      }),
    },
    {
      name: "raises stale past scheduledAt to current time when unblocking",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const past = new Date(Date.now() - 60 * 60 * 1000);

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
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "main",
                  input: null,
                  schedule: { at: past },
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
                { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
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

        const result = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.unblockJobs({
              txCtx,
              blockedByChainId: blockerChain.head.chainId,
            }),
          ),
        );

        assert.equal(result.length, 1);
        const unblockedAt = result[0].job.scheduledAt.getTime();
        assert.ok(unblockedAt - past.getTime() > 30 * 60 * 1000);
        assert.ok(Math.abs(unblockedAt - Date.now()) < 60 * 1000);
      }),
    },
    {
      name: "preserves future scheduledAt when unblocking",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const future = new Date(Date.now() + 60 * 60 * 1000);

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
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "main",
                  input: null,
                  schedule: { at: future },
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
                { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
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

        const result = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.unblockJobs({
              txCtx,
              blockedByChainId: blockerChain.head.chainId,
            }),
          ),
        );

        assert.equal(result.length, 1);
        assert.equal(result[0].job.scheduledAt.getTime(), future.getTime());
      }),
    },
    {
      name: "unblocked job with stale past scheduledAt does not jump ahead of already-ready jobs",
      run: dynamicSyncAsync(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["fairness-main"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const longPast = new Date(Date.now() - 60 * 60 * 1000);
        const recentPast = new Date(Date.now() - 60 * 1000);

        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
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
          ),
        );

        const [blockedMainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
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
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: blockedMainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          ),
        );

        const [readyMainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
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

        yield* wait(sleep(10));

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.unblockJobs({
              txCtx,
              blockedByChainId: blockerChain.head.chainId,
            }),
          ),
        );

        const [first] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            batchLimits: { "fairness-main": 1 },
            limit: 1,
          }),
        );
        const [second] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            batchLimits: { "fairness-main": 1 },
            limit: 1,
          }),
        );

        assert.equal(first.id, readyMainChain.head.id);
        assert.equal(second.id, blockedMainChain.head.id);
      }),
    },
    {
      name: "returns blocker rows with a null trace context when none was stored",
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

        const result = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.unblockJobs({
              txCtx,
              blockedByChainId: blockerChain.head.chainId,
            }),
          ),
        );

        assert.equal(result.length, 1);
        assert.equal(result[0].jobId, mainChain.head.id);
        assert.equal(result[0].traceContext, null);
      }),
    },
    {
      name: "completing a blocked job clears blocked so it never resurfaces",
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

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: mainChain.head.id, output: "done" }],
            }),
          ),
        );

        const [completedJob] = yield* step(stateAdapter.getJobs({ jobIds: [mainChain.head.id] }));
        assert.equal(completedJob!.status, "completed");

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerChain.head.id, output: null }],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.unblockJobs({
              txCtx,
              blockedByChainId: blockerChain.head.chainId,
            }),
          ),
        );

        assert.equal(result.length, 1);
        assert.equal(result[0].jobId, mainChain.head.id);
        assert.equal(result[0].job.status, "completed");
        assert.notEqual(result[0].job.completedAt, null);

        const [job] = yield* step(stateAdapter.getJobs({ jobIds: [mainChain.head.id] }));
        assert.equal(job!.status, "completed");
        assert.notEqual(job!.completedAt, null);
      }),
    },
  ],
};

export const unblockJobsConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "unblockJobs",
    cases: [
      {
        name: "concurrent completions of 16 blocker chains in 8 lanes unblock each of 200 dependents exactly when its last blocker completes",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();
          const blockerChains = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: 16 }, (_, index) => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "fan-in-blocker",
                input: { index },
              })),
            }),
          );
          const dependents = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: 200 }, (_, index) => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "fan-in-dependent",
                input: { index },
              })),
            }),
          );
          const blockerIndexes = (dependentIndex: number) =>
            [0, 3, 7, 12].map((offset) => (dependentIndex + offset) % 16);
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: dependents.map((dependent, dependentIndex) => ({
                jobId: dependent.head.id,
                blockedByChainIds: blockerIndexes(dependentIndex).map(
                  (blockerIndex) => blockerChains[blockerIndex].head.chainId,
                ),
              })),
            }),
          );

          const complete = async (blockerIndex: number) => {
            const blocker = blockerChains[blockerIndex].head;
            await stateAdapter.withTransaction(async (txCtx) => {
              await stateAdapter.completeJobs({
                txCtx,
                jobs: [{ jobId: blocker.id, output: null }],
              });
              await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blocker.chainId });
            });
          };
          const completeInLanes = async (blockerIndexesToComplete: number[]) => {
            const failed: number[] = [];
            await Promise.all(
              Array.from({ length: 8 }, async (_, lane) => {
                for (const blockerIndex of blockerIndexesToComplete.filter(
                  (_, position) => position % 8 === lane,
                )) {
                  await complete(blockerIndex).catch(() => {
                    failed.push(blockerIndex);
                  });
                }
              }),
            );
            for (const blockerIndex of failed) await complete(blockerIndex);
          };
          const statuses = async () =>
            (
              await stateAdapter.getJobs({
                jobIds: dependents.map((dependent) => dependent.head.id),
              })
            ).map((job) => job?.status);

          await completeInLanes([0, 1, 2, 3, 4, 5, 6, 7]);
          assert.deepEqual(
            await statuses(),
            dependents.map((_, dependentIndex) =>
              blockerIndexes(dependentIndex).every((blockerIndex) => blockerIndex < 8)
                ? "pending"
                : "blocked",
            ),
          );

          await completeInLanes([8, 9, 10, 11, 12, 13, 14, 15]);
          assert.deepEqual(
            await statuses(),
            dependents.map(() => "pending"),
          );
        },
      },
    ],
  };

export const unblockJobsConcurrentTransactionsTwoConnectionGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "unblockJobs",
    cases: [
      {
        name: "concurrent blocker chain completions unblock all jobs sharing those blockers",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();
          const blockerCount = 5;
          const mainCount = 5;

          const blockerJobs = (
            await stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: Array.from({ length: blockerCount }, (_, index) => ({
                  id: stateAdapter.config.generateJobId(),
                  typeName: "shared-blocker",
                  input: { index },
                })),
              }),
            )
          ).map((r) => r.head);

          const mainJobs = (
            await stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: Array.from({ length: mainCount }, (_, index) => ({
                  id: stateAdapter.config.generateJobId(),
                  typeName: "shared-main",
                  input: { index },
                })),
              }),
            )
          ).map((r) => r.head);

          await stateAdapter.withTransaction((txCtx) =>
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

export const unblockJobsConcurrentTransactionsLockWaitGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "unblockJobs",
    cases: [
      {
        name: "unblocks a dependent whose blocker was added before the chain completed, without a caller pre-lock",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [{ id: chainId }] = await stateAdapter.withTransaction((txCtx) =>
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
          const [continued] = await stateAdapter.withTransaction((txCtx) =>
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

          const [{ id: chainId }] = await stateAdapter.withTransaction((txCtx) =>
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
          const [continued] = await stateAdapter.withTransaction((txCtx) =>
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
          const [blockers] = await stateAdapter.getJobsBlockers({ jobIds: [dependent.id] });
          assert.deepEqual(
            blockers.map((blocker) => blocker.id),
            [chainId],
          );
        },
      },
    ],
  };
