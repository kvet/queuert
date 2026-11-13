import assert from "node:assert/strict";

import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { raceWithSleep, sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;
const SETTLE_BOUND_MS = 2_000;

export const startJobAttemptGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "startJobAttempts",
  cases: [
    {
      name: "acquires oldest eligible pending job",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["acquire-test"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "acquire-test",
                  input: { order: 1 },
                },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "acquire-test",
                  input: { order: 2 },
                },
              ],
            }),
          ),
        );

        const [acquired] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["acquire-test"],
            limit: 1,
          }),
        );

        assert.notEqual(acquired, undefined);
        assert.deepEqual(acquired.input, { order: 1 });
        assert.equal(acquired.status, "running");
        assert.ok(acquired.attemptAt instanceof Date);
        assert.equal(acquired.attemptBy, worker.id);
        assert.equal(typeof acquired.attemptToken, "string");
        assert.equal(acquired.completedAt, null);
        assert.equal(acquired.attempt, 1);
      }),
    },
    {
      name: "returns no jobs when no eligible jobs exist",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["nonexistent-type"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const acquired = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["nonexistent-type"],
            limit: 1,
          }),
        );

        assert.deepEqual(acquired, []);
      }),
    },
    {
      name: "does not acquire blocked jobs",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["blocked-skip"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocked-skip", input: null },
              ],
            }),
          ),
        );

        const [mainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocked-skip", input: null },
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

        const [acquired] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["blocked-skip"],
            limit: 1,
          }),
        );

        assert.notEqual(acquired, undefined);
        assert.equal(acquired.id, blockerChain.head.id);
      }),
    },
    {
      name: "does not acquire blocked jobs when no unblocked jobs exist",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["blocked-only"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocked-only", input: null },
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

        const [blockedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "blocked-only",
                  input: { value: "blocked" },
                },
              ],
            }),
          ),
        );

        const [anotherBlockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocked-only", input: null },
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
                  jobId: blockedChain.head.id,
                  blockedByChainIds: [anotherBlockerChain.head.chainId],
                },
              ],
            }),
          ),
        );

        const [acquired] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["blocked-only"],
            limit: 1,
          }),
        );

        assert.notEqual(acquired, undefined);
        assert.equal(acquired.id, anotherBlockerChain.head.id);

        const acquired2 = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["blocked-only"],
            limit: 1,
          }),
        );

        assert.deepEqual(acquired2, []);
      }),
    },
    {
      name: "does not acquire jobs scheduled in the future",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["future-acquire"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "future-acquire",
                  input: null,
                  schedule: { afterMs: 60_000 },
                },
              ],
            }),
          ),
        );

        const acquired = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["future-acquire"],
            limit: 1,
          }),
        );

        assert.deepEqual(acquired, []);
      }),
    },
    {
      name: "acquires up to limit jobs, oldest first",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["acquire-limit"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const createdChains = [];
        for (let order = 1; order <= 3; order++) {
          const [createdChain] = yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: "acquire-limit",
                    input: { order },
                  },
                ],
              }),
            ),
          );
          createdChains.push(createdChain);
        }

        const firstBatch = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["acquire-limit"],
            limit: 2,
          }),
        );
        assert.deepEqual(
          firstBatch.map((job) => job.id).sort(),
          [createdChains[0].head.id, createdChains[1].head.id].sort(),
        );
        for (const job of firstBatch) {
          assert.equal(job.status, "running");
          assert.equal(job.attemptBy, worker.id);
          assert.equal(job.attempt, 1);
        }
        assert.equal(new Set(firstBatch.map((job) => job.attemptToken)).size, firstBatch.length);

        const secondBatch = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["acquire-limit"],
            limit: 5,
          }),
        );
        assert.deepEqual(
          secondBatch.map((job) => job.id),
          [createdChains[2].head.id],
        );
      }),
    },
    {
      name: "acquires jobs of several types in one call",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["acquire-multi-a", "acquire-multi-b"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [chainA, chainB] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "acquire-multi-a",
                  input: null,
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "acquire-multi-b",
                  input: null,
                },
              ],
            }),
          ),
        );

        const acquired = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["acquire-multi-a", "acquire-multi-b"],
            limit: 5,
          }),
        );

        assert.deepEqual(
          acquired.map((job) => job.id).sort(),
          [chainA.head.id, chainB.head.id].sort(),
        );
        for (const job of acquired) {
          assert.equal(job.chain.id, job.chainId);
          assert.equal(job.hasBlockers, false);
        }
      }),
    },
    {
      name: "returns the acquired job's chain",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["acquire-chain"],
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
                  typeName: "acquire-chain",
                  input: null,
                  chainTraceContext: "chain-trace",
                },
              ],
            }),
          ),
        );

        const [acquired] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["acquire-chain"],
            limit: 1,
          }),
        );

        assert.notEqual(acquired, undefined);
        assert.equal(acquired.chain.id, stateChain.head.chainId);
        assert.equal(acquired.chain.typeName, "acquire-chain");
        assert.equal(acquired.chain.completedAt, null);
        assert.equal(acquired.chain.traceContext, "chain-trace");
      }),
    },
    {
      name: "reports hasBlockers only for jobs that have blocker rows",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["has-blockers", "has-no-blockers"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "has-blockers-blocker",
                  input: null,
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

        const [withBlockersChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "has-blockers", input: null },
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
                  jobId: withBlockersChain.head.id,
                  blockedByChainIds: [blockerChain.head.chainId],
                },
              ],
            }),
          ),
        );

        const [acquiredWithBlockers] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["has-blockers"],
            limit: 1,
          }),
        );

        assert.notEqual(acquiredWithBlockers, undefined);
        assert.equal(acquiredWithBlockers.id, withBlockersChain.head.id);
        assert.equal(acquiredWithBlockers.hasBlockers, true);

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "has-no-blockers",
                  input: null,
                },
              ],
            }),
          ),
        );

        const [acquiredWithoutBlockers] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["has-no-blockers"],
            limit: 1,
          }),
        );

        assert.notEqual(acquiredWithoutBlockers, undefined);
        assert.equal(acquiredWithoutBlockers.hasBlockers, false);
      }),
    },
    {
      name: "only acquires jobs of typeNames",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["timeout-unrelated"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "timeout-other", input: null },
              ],
            }),
          ),
        );

        const acquired = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["timeout-unrelated"],
            limit: 1,
          }),
        );
        assert.deepEqual(acquired, []);
      }),
    },
    {
      name: "acquires without a txCtx, committing the attempt on its own",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["acquire-autocommit"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const otherWorker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["acquire-autocommit"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "acquire-autocommit",
                  input: null,
                },
              ],
            }),
          ),
        );

        const [acquired] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["acquire-autocommit"],
            limit: 1,
          }),
        );
        assert.equal(acquired.id, createdChain.head.id);
        assert.equal(acquired.status, "running");
        assert.equal(acquired.attempt, 1);

        const [stored] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));
        assert.equal(stored!.status, "running");
        assert.equal(stored!.attempt, 1);
        assert.equal(stored!.attemptBy, worker.id);

        const again = yield* step(
          stateAdapter.startJobAttempts({
            workerId: otherWorker.id,
            workerToken: otherWorker.token,
            typeNames: ["acquire-autocommit"],
            limit: 1,
          }),
        );
        assert.deepEqual(again, []);
      }),
    },
    {
      name: "claims nothing for a worker with no row",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "gate-no-row", input: null },
              ],
            }),
          ),
        );

        assert.deepEqual(
          yield* step(
            stateAdapter.startJobAttempts({
              workerId: stateAdapter.config.generateWorkerId(),
              workerToken: crypto.randomUUID(),
              typeNames: ["gate-no-row"],
              limit: 1,
            }),
          ),
          [],
        );

        const [stored] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));
        assert.equal(stored!.status, "pending");
        assert.equal(stored!.attempt, 0);
        assert.equal(stored!.attemptBy, null);
      }),
    },
    {
      name: "claims nothing once the worker's lease expired",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["gate-expired"],
            concurrency: 1,
            leaseMs: 1,
          }),
        );
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "gate-expired", input: null },
              ],
            }),
          ),
        );
        yield* wait(sleep(20));

        assert.deepEqual(
          yield* step(
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["gate-expired"],
              limit: 1,
            }),
          ),
          [],
        );

        const [stored] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));
        assert.equal(stored!.status, "pending");
        assert.equal(stored!.attempt, 0);
        assert.equal(stored!.attemptBy, null);
      }),
    },
    {
      name: "claims nothing after the worker stopped",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["gate-stopped"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "gate-stopped", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "gate-stopped", input: null },
              ],
            }),
          ),
        );

        assert.equal(
          (yield* step(
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["gate-stopped"],
              limit: 1,
            }),
          )).length,
          1,
        );

        yield* step(
          stateAdapter.stopWorker({
            workerId: worker.id,
            workerToken: worker.token,
          }),
        );

        assert.deepEqual(
          yield* step(
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["gate-stopped"],
              limit: 1,
            }),
          ),
          [],
        );
      }),
    },
    {
      name: "claims nothing for a stale registration of the worker",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const workerId = stateAdapter.config.generateWorkerId();
        const staleRun = yield* step(
          stateAdapter.startWorker({
            workerId,
            typeNames: ["gate-stale-run"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(stateAdapter.stopWorker({ workerId, workerToken: staleRun.token }));
        yield* wait(sleep(5));
        const currentRun = yield* step(
          stateAdapter.startWorker({
            workerId,
            typeNames: ["gate-stale-run"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        assert.notEqual(currentRun.startedAt.getTime(), staleRun.startedAt.getTime());
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "gate-stale-run",
                  input: null,
                },
              ],
            }),
          ),
        );

        assert.deepEqual(
          yield* step(
            stateAdapter.startJobAttempts({
              workerId,
              workerToken: staleRun.token,
              typeNames: ["gate-stale-run"],
              limit: 1,
            }),
          ),
          [],
        );

        const [stored] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));
        assert.equal(stored!.status, "pending");
        assert.equal(stored!.attempt, 0);
        assert.equal(stored!.attemptBy, null);

        const [claimed] = yield* step(
          stateAdapter.startJobAttempts({
            workerId,
            workerToken: currentRun.token,
            typeNames: ["gate-stale-run"],
            limit: 1,
          }),
        );
        assert.equal(claimed.id, createdChain.head.id);
        assert.equal(claimed.attemptBy, workerId);
      }),
    },
  ],
};

export const startJobAttemptHeldTransactionGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "startJobAttempt",
    cases: [
      {
        name: "claims a job whose schedule passed during an open transaction",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const jobId = stateAdapter.config.generateJobId();

          const acquired = await stateAdapter.withTransaction(async (txCtx) => {
            const worker = await stateAdapter.startWorker({
              txCtx,
              workerId: stateAdapter.config.generateWorkerId(),
              typeNames: ["acquire-schedule-in-tx"],
              concurrency: 1,
              leaseMs: 60_000,
            });
            await stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: jobId,
                  typeName: "acquire-schedule-in-tx",
                  input: null,
                  schedule: { afterMs: 100 },
                },
              ],
            });
            await sleep(300);
            return stateAdapter.startJobAttempts({
              txCtx,
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["acquire-schedule-in-tx"],
              limit: 1,
            });
          });

          assert.deepEqual(
            acquired.map((job) => job.id),
            [jobId],
          );
        },
      },
      {
        name: "a claim waiting on a transaction that locks and deletes the worker claims nothing",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const worker = await stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["gate-reclaimed"],
            concurrency: 1,
            leaseMs: 60_000,
          });
          const [createdChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "gate-reclaimed",
                  input: null,
                },
              ],
            }),
          );

          const reclaimerGate = Promise.withResolvers<void>();
          const workerLocked = Promise.withResolvers<void>();

          const reclaimerTx = stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.getWorkers({ txCtx, workerIds: [worker.id], lock: "exclusive" });
            workerLocked.resolve();
            await reclaimerGate.promise;
            await stateAdapter.stopWorker({
              txCtx,
              workerId: worker.id,
              workerToken: worker.token,
            });
          });

          await workerLocked.promise;

          const claim = Promise.resolve(
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["gate-reclaimed"],
              limit: 1,
            }),
          );

          assert.equal(
            await Promise.race([
              claim.then(() => "resolved"),
              sleep(LOCK_BLOCK_OBSERVATION_MS).then(() => "waiting"),
            ]),
            "waiting",
          );

          reclaimerGate.resolve();
          await reclaimerTx;

          assert.deepEqual(await claim, []);
          const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
          assert.equal(stored!.status, "pending");
          assert.equal(stored!.attemptBy, null);
        },
      },
    ],
  };

export const startJobAttemptConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "startJobAttempts",
    cases: [
      {
        name: "parallel calls return distinct jobs (no double-dispatch)",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const worker = await stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["acquire-concurrency"],
            concurrency: 1,
            leaseMs: 60_000,
          });
          const count = 5;
          await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: count }, (_, i) => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "acquire-concurrency",
                input: { index: i },
              })),
            }),
          );

          const results = await Promise.all(
            Array.from({ length: count }, async () =>
              stateAdapter.startJobAttempts({
                workerId: worker.id,
                workerToken: worker.token,
                typeNames: ["acquire-concurrency"],
                limit: 1,
              }),
            ),
          );

          const acquiredJobs = results.flat();
          const acquiredIds = new Set(acquiredJobs.map((result) => result.id));

          assert.equal(acquiredJobs.length, count);
          assert.equal(acquiredIds.size, count);
        },
      },
      {
        name: "parallel batched calls return disjoint jobs",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const worker = await stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["acquire-batch-concurrency"],
            concurrency: 1,
            leaseMs: 60_000,
          });
          const count = 10;
          await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: count }, (_, index) => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "acquire-batch-concurrency",
                input: { index },
              })),
            }),
          );

          const results = await Promise.all(
            Array.from({ length: 4 }, async () =>
              stateAdapter.startJobAttempts({
                workerId: worker.id,
                workerToken: worker.token,
                typeNames: ["acquire-batch-concurrency"],
                limit: 3,
              }),
            ),
          );
          const acquiredIds = results.flat().map((job) => job.id);

          assert.equal(new Set(acquiredIds).size, acquiredIds.length);
          for (const batch of results) {
            assert.ok(batch.length <= 3);
          }

          const remaining = await stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["acquire-batch-concurrency"],
            limit: count,
          });
          assert.equal(acquiredIds.length + remaining.length, count);
        },
      },
      {
        name: "a claim in an open transaction leaves the other due jobs to a concurrent claim",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const firstWorker = await stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["claim-footprint"],
            concurrency: 1,
            leaseMs: 60_000,
          });
          const secondWorker = await stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["claim-footprint"],
            concurrency: 1,
            leaseMs: 60_000,
          });
          const count = 10;
          const firstLimit = 3;
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: count }, (_, index) => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "claim-footprint",
                input: { index },
              })),
            }),
          );

          const firstClaimed = Promise.withResolvers<void>();
          const releaseFirst = Promise.withResolvers<void>();
          const firstTx = stateAdapter.withTransaction(async (txCtx) => {
            const jobs = await stateAdapter.startJobAttempts({
              txCtx,
              workerId: firstWorker.id,
              workerToken: firstWorker.token,
              typeNames: ["claim-footprint"],
              limit: firstLimit,
            });
            firstClaimed.resolve();
            await releaseFirst.promise;
            return jobs;
          });
          await firstClaimed.promise;

          const secondClaim = stateAdapter.startJobAttempts({
            workerId: secondWorker.id,
            workerToken: secondWorker.token,
            typeNames: ["claim-footprint"],
            limit: count - firstLimit,
          });
          try {
            assert.equal(
              await raceWithSleep(
                Promise.resolve(secondClaim).then(() => "settled"),
                SETTLE_BOUND_MS,
              ),
              "settled",
            );
          } finally {
            releaseFirst.resolve();
          }

          const firstJobs = await firstTx;
          const secondJobs = await secondClaim;
          assert.equal(firstJobs.length, firstLimit);
          assert.equal(secondJobs.length, count - firstLimit);
          const claimedIds = [...firstJobs, ...secondJobs].map((job) => job.id);
          assert.equal(new Set(claimedIds).size, count);
        },
      },
      {
        name: "a producer does not wait on an open claim that drained the queue",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const worker = await stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["claim-drained"],
            concurrency: 1,
            leaseMs: 60_000,
          });
          const [lastChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "claim-drained", input: null },
              ],
            }),
          );

          const claimed = Promise.withResolvers<void>();
          const releaseClaim = Promise.withResolvers<void>();
          const claimTx = stateAdapter.withTransaction(async (txCtx) => {
            const jobs = await stateAdapter.startJobAttempts({
              txCtx,
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["claim-drained"],
              limit: 5,
            });
            claimed.resolve();
            await releaseClaim.promise;
            return jobs;
          });
          await claimed.promise;

          const producedId = stateAdapter.config.generateJobId();
          const produce = stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: producedId, typeName: "claim-drained", input: null }],
            }),
          );
          try {
            assert.equal(
              await raceWithSleep(
                Promise.resolve(produce).then(() => "settled"),
                SETTLE_BOUND_MS,
              ),
              "settled",
            );
          } finally {
            releaseClaim.resolve();
          }

          const [produced] = await produce;
          const claimedIds = (await claimTx).map((job) => job.id);
          assert.ok(claimedIds.includes(lastChain.head.id));
          assert.equal(produced.head.id, producedId);
          const [stored] = await stateAdapter.getJobs({ jobIds: [producedId] });
          assert.equal(stored!.typeName, "claim-drained");
        },
      },
      {
        name: "acquires a due job while only its chain head is locked",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const worker = await stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["locked-head-acquire"],
            concurrency: 1,
            leaseMs: 60_000,
          });

          const [lockedChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "locked-head", input: null },
              ],
            }),
          );
          const [continued] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "locked-head-acquire",
                  input: null,
                  continueFromId: lockedChain.head.id,
                },
              ],
            }),
          );
          const continuation = continued!.continuation;

          let signalHeadLocked: (() => void) | undefined;
          const headLocked = new Promise<void>((r) => {
            signalHeadLocked = r;
          });
          let releaseHead: (() => void) | undefined;
          const headGate = new Promise<void>((r) => {
            releaseHead = r;
          });

          const lockerTx = stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.getChains({ txCtx, chainIds: [lockedChain.id], lock: "exclusive" });
            signalHeadLocked!();
            await headGate;
          });

          await headLocked;

          try {
            assert.equal(
              await stateAdapter.getStartAttemptDelayMs({ typeNames: ["locked-head-acquire"] }),
              0,
            );

            const [acquired] = await stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["locked-head-acquire"],
              limit: 1,
            });
            assert.equal(acquired?.id, continuation.id);
          } finally {
            releaseHead!();
            await lockerTx;
          }
        },
      },
      {
        name: "skips a due job whose row is locked and getStartAttemptDelayMs ignores it",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const worker = await stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["locked-job"],
            concurrency: 1,
            leaseMs: 60_000,
          });

          const [lockedChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "locked-job", input: null },
              ],
            }),
          );

          let signalJobLocked: (() => void) | undefined;
          const jobLocked = new Promise<void>((r) => {
            signalJobLocked = r;
          });
          let releaseJob: (() => void) | undefined;
          const jobGate = new Promise<void>((r) => {
            releaseJob = r;
          });

          const lockerTx = stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.getJobs({ txCtx, jobIds: [lockedChain.head.id], lock: "exclusive" });
            signalJobLocked!();
            await jobGate;
          });

          await jobLocked;

          try {
            assert.equal(
              await stateAdapter.getStartAttemptDelayMs({ typeNames: ["locked-job"] }),
              null,
            );

            const [otherChain] = await stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [
                  { id: stateAdapter.config.generateJobId(), typeName: "locked-job", input: null },
                ],
              }),
            );
            assert.equal(
              await stateAdapter.getStartAttemptDelayMs({ typeNames: ["locked-job"] }),
              0,
            );

            const [acquired] = await stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["locked-job"],
              limit: 1,
            });
            assert.equal(acquired?.id, otherChain.head.id);
          } finally {
            releaseJob!();
            await lockerTx;
          }

          const [acquiredAfterRelease] = await stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["locked-job"],
            limit: 1,
          });
          assert.equal(acquiredAfterRelease?.id, lockedChain.head.id);
        },
      },
    ],
  };
