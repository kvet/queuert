import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import { SchemaFencedError } from "../../errors.ts";
import type { StateChain } from "../../state-adapter/state-adapter.ts";
import type { SchemaFenceConformanceContext } from "../types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const schemaFenceGroup: ConformanceGroup<SchemaFenceConformanceContext> = {
  name: "schemaFence",
  cases: [
    {
      name: "createJobs fails with SchemaFencedError once its writes are fenced, even through a statement that already ran, creating nothing",
      run: async ({ createStateAdapter, withWritesFenced }) => {
        await using stateAdapter = await createStateAdapter();

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "fenced-create", input: null },
            ],
          }),
        );
        const fencedJobId = stateAdapter.config.generateJobId();

        const error = await withWritesFenced(async () =>
          stateAdapter
            .withTransaction(async (txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [{ id: fencedJobId, typeName: "fenced-create", input: null }],
              }),
            )
            .catch((caught: unknown) => caught),
        );

        assert.ok(error instanceof SchemaFencedError);
        assert.notEqual(error.cause, undefined);
        assert.deepEqual(await stateAdapter.getJobs({ jobIds: [fencedJobId] }), [undefined]);
      },
    },
    {
      name: "continueJobs fails with SchemaFencedError once its writes are fenced, leaving the running job unchanged",
      run: async ({ createStateAdapter, withWritesFenced }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["fenced-continue"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "fenced-continue", input: null },
            ],
          }),
        );
        const [job] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["fenced-continue"],
          limit: 1,
        });
        const before = await stateAdapter.getJobs({ jobIds: [job.id] });
        const continuationId = stateAdapter.config.generateJobId();

        await withWritesFenced(async () =>
          assert.rejects(
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.continueJobs({
                txCtx,
                jobs: [
                  {
                    id: continuationId,
                    typeName: "fenced-continue:next",
                    input: null,
                    continueFromId: job.id,
                    attemptToken: job.attemptToken!,
                    workerId: job.attemptBy!,
                  },
                ],
              }),
            ),
            SchemaFencedError,
          ),
        );

        assert.deepEqual(await stateAdapter.getJobs({ jobIds: [job.id] }), before);
        assert.deepEqual(await stateAdapter.getJobs({ jobIds: [continuationId] }), [undefined]);
      },
    },
    {
      name: "addJobsBlockers fails with SchemaFencedError once its writes are fenced, adding no blocker",
      run: async ({ createStateAdapter, withWritesFenced }) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "fenced-blocker", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "fenced-main", input: null },
            ],
          }),
        );
        const before = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });

        await withWritesFenced(async () =>
          assert.rejects(
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
              }),
            ),
            SchemaFencedError,
          ),
        );

        assert.deepEqual(await stateAdapter.getJobs({ jobIds: [mainChain.head.id] }), before);
        assert.deepEqual(await stateAdapter.getJobBlockers({ jobId: mainChain.head.id }), []);
      },
    },
    {
      name: "unblockJobs fails with SchemaFencedError once its writes are fenced, leaving the dependent blocked",
      run: async ({ createStateAdapter, withWritesFenced }) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain, mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "fenced-blocker", input: null },
              { id: stateAdapter.config.generateJobId(), typeName: "fenced-main", input: null },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );
        const before = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });

        await withWritesFenced(async () =>
          assert.rejects(
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id }),
            ),
            SchemaFencedError,
          ),
        );

        assert.equal(before[0]!.status, "blocked");
        assert.deepEqual(await stateAdapter.getJobs({ jobIds: [mainChain.head.id] }), before);
      },
    },
    {
      name: "startWorker fails with SchemaFencedError once its writes are fenced, registering no worker",
      run: async ({ createStateAdapter, withWritesFenced }) => {
        await using stateAdapter = await createStateAdapter();

        const workerId = stateAdapter.config.generateWorkerId();

        await withWritesFenced(async () =>
          assert.rejects(
            stateAdapter.startWorker({
              workerId,
              typeNames: ["fenced-worker"],
              concurrency: 1,
              leaseMs: 60_000,
            }),
            SchemaFencedError,
          ),
        );

        assert.deepEqual(await stateAdapter.getWorkers({ workerIds: [workerId] }), [undefined]);
      },
    },
    {
      name: "extendWorkerLease fails with SchemaFencedError once its writes are fenced, leaving the lease unchanged",
      run: async ({ createStateAdapter, withWritesFenced }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["fenced-lease"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const before = await stateAdapter.getWorkers({ workerIds: [worker.id] });

        await withWritesFenced(async () =>
          assert.rejects(
            stateAdapter.extendWorkerLease({
              workerId: worker.id,
              workerToken: worker.token,
              leaseMs: 120_000,
            }),
            SchemaFencedError,
          ),
        );

        assert.deepEqual(await stateAdapter.getWorkers({ workerIds: [worker.id] }), before);
      },
    },
    {
      name: "startJobAttempts fails with SchemaFencedError once its writes are fenced, leaving the job pending",
      run: async ({ createStateAdapter, withWritesFenced }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["fenced-start-attempt"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "fenced-start-attempt",
                input: null,
              },
            ],
          }),
        );
        const before = await stateAdapter.getJobs({ jobIds: [chain.head.id] });

        await withWritesFenced(async () =>
          assert.rejects(
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["fenced-start-attempt"],
              limit: 1,
            }),
            SchemaFencedError,
          ),
        );

        assert.deepEqual(await stateAdapter.getJobs({ jobIds: [chain.head.id] }), before);
      },
    },
    {
      name: "completeJobs fails with SchemaFencedError once its writes are fenced, leaving the job unchanged",
      run: async ({ createStateAdapter, withWritesFenced }) => {
        await using stateAdapter = await createStateAdapter();

        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "fenced-complete", input: null },
            ],
          }),
        );
        const before = await stateAdapter.getJobs({ jobIds: [chain.head.id] });

        await withWritesFenced(async () =>
          assert.rejects(
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.completeJobs({ txCtx, jobs: [{ jobId: chain.head.id, output: null }] }),
            ),
            SchemaFencedError,
          ),
        );

        assert.deepEqual(await stateAdapter.getJobs({ jobIds: [chain.head.id] }), before);
      },
    },
    {
      name: "rescheduleJobs fails with SchemaFencedError once its writes are fenced, leaving the job unchanged",
      run: async ({ createStateAdapter, withWritesFenced }) => {
        await using stateAdapter = await createStateAdapter();

        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "fenced-reschedule",
                input: null,
              },
            ],
          }),
        );
        const before = await stateAdapter.getJobs({ jobIds: [chain.head.id] });

        await withWritesFenced(async () =>
          assert.rejects(
            stateAdapter.rescheduleJobs({
              jobs: [{ jobId: chain.head.id, schedule: { afterMs: 60_000 } }],
            }),
            SchemaFencedError,
          ),
        );

        assert.deepEqual(await stateAdapter.getJobs({ jobIds: [chain.head.id] }), before);
      },
    },
    {
      name: "reads and deletes chains while writes are fenced",
      run: async ({ createStateAdapter, withWritesFenced }) => {
        await using stateAdapter = await createStateAdapter();

        const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "fenced-delete", input: null },
            ],
          }),
        );

        await withWritesFenced(async () => {
          const [job] = await stateAdapter.getJobs({ jobIds: [chain.head.id] });
          assert.equal(job?.id, chain.head.id);
          const [deleted] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [chain.id] }),
          );
          assert.equal((deleted as StateChain).id, chain.id);
        });

        assert.deepEqual(await stateAdapter.getJobs({ jobIds: [chain.head.id] }), [undefined]);
      },
    },
  ],
};

export const schemaFenceConcurrentTransactionsGroup: ConformanceGroup<SchemaFenceConformanceContext> =
  {
    name: "schemaFence",
    cases: [
      {
        name: "fails a write with SchemaFencedError when its writes are fenced after the transaction began",
        run: async ({ createStateAdapter, withWritesFenced }) => {
          await using stateAdapter = await createStateAdapter();

          const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "fenced-open-tx",
                  input: null,
                },
              ],
            }),
          );
          const fencedJobId = stateAdapter.config.generateJobId();

          await assert.rejects(
            stateAdapter.withTransaction(async (txCtx) => {
              await stateAdapter.getJobs({ txCtx, jobIds: [chain.head.id] });
              await withWritesFenced(async () =>
                stateAdapter.createJobs({
                  txCtx,
                  jobs: [{ id: fencedJobId, typeName: "fenced-open-tx", input: null }],
                }),
              );
            }),
            SchemaFencedError,
          );

          assert.deepEqual(await stateAdapter.getJobs({ jobIds: [fencedJobId] }), [undefined]);
        },
      },
      {
        name: "commits a transaction that already wrote before its writes are fenced",
        run: async ({ createStateAdapter, withWritesFenced }) => {
          await using stateAdapter = await createStateAdapter();

          const jobId = stateAdapter.config.generateJobId();
          let dropped = false;
          let readAfterDrop: Promise<unknown> | undefined;

          await stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: jobId, typeName: "fenced-committed", input: null }],
            });
            readAfterDrop = withWritesFenced(async () => {
              dropped = true;
              return stateAdapter.getJobs({ jobIds: [jobId] });
            });
            await sleep(LOCK_BLOCK_OBSERVATION_MS);
            assert.equal(dropped, false);
          });

          const [job] = (await readAfterDrop) as ({ id: string } | undefined)[];
          assert.equal(job?.id, jobId);
        },
      },
    ],
  };
