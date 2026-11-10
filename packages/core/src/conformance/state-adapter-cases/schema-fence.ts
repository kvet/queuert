import { sleep } from "@queuert/helpers";

import { SchemaFencedError } from "../../errors.ts";
import type { StateChain } from "../../state-adapter/state-adapter.ts";
import type { ConformanceGroup } from "../runner.ts";
import type { StateConformanceFixture } from "./types.ts";

const LOCK_BLOCK_OBSERVATION_MS = 100;

/**
 * Fixture for the schema fence cases: the state adapter fixture plus a way to fence the
 * adapter's writes. Only adapters that fence writes behind a schema fence table run these cases.
 */
export type SchemaFenceConformanceFixture = StateConformanceFixture & {
  /**
   * Fences the adapter's writes while the callback runs, as a later breaking migration would,
   * then lifts the fence: drop the fence table, run the callback, recreate it. The cases use it
   * to verify that every write fails with `SchemaFencedError` and changes nothing, and that
   * reads and deletes keep working.
   */
  withWritesFenced: <T>(fn: () => Promise<T>) => Promise<T>;
};

export const schemaFenceGroup: ConformanceGroup<SchemaFenceConformanceFixture> = {
  name: "schemaFence",
  cases: [
    {
      name: "createJobs fails with SchemaFencedError once its writes are fenced, even through a statement that already ran, creating nothing",
      run: async ({ stateAdapter, withWritesFenced }, expect) => {
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

        expect(error).toBeInstanceOf(SchemaFencedError);
        expect((error as SchemaFencedError).cause).toBeDefined();
        expect(await stateAdapter.getJobs({ jobIds: [fencedJobId] })).toEqual([undefined]);
      },
    },
    {
      name: "continueJobs fails with SchemaFencedError once its writes are fenced, leaving the running job unchanged",
      run: async ({ stateAdapter, withWritesFenced }, expect) => {
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
          expect(
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
          ).rejects.toThrow(SchemaFencedError),
        );

        expect(await stateAdapter.getJobs({ jobIds: [job.id] })).toEqual(before);
        expect(await stateAdapter.getJobs({ jobIds: [continuationId] })).toEqual([undefined]);
      },
    },
    {
      name: "addJobsBlockers fails with SchemaFencedError once its writes are fenced, adding no blocker",
      run: async ({ stateAdapter, withWritesFenced }, expect) => {
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
          expect(
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
              }),
            ),
          ).rejects.toThrow(SchemaFencedError),
        );

        expect(await stateAdapter.getJobs({ jobIds: [mainChain.head.id] })).toEqual(before);
        expect(await stateAdapter.getJobBlockers({ jobId: mainChain.head.id })).toEqual([]);
      },
    },
    {
      name: "unblockJobs fails with SchemaFencedError once its writes are fenced, leaving the dependent blocked",
      run: async ({ stateAdapter, withWritesFenced }, expect) => {
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
          expect(
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id }),
            ),
          ).rejects.toThrow(SchemaFencedError),
        );

        expect(before[0]!.status).toBe("blocked");
        expect(await stateAdapter.getJobs({ jobIds: [mainChain.head.id] })).toEqual(before);
      },
    },
    {
      name: "startWorker fails with SchemaFencedError once its writes are fenced, registering no worker",
      run: async ({ stateAdapter, withWritesFenced }, expect) => {
        const workerId = stateAdapter.config.generateWorkerId();

        await withWritesFenced(async () =>
          expect(
            stateAdapter.startWorker({
              workerId,
              typeNames: ["fenced-worker"],
              concurrency: 1,
              leaseMs: 60_000,
            }),
          ).rejects.toThrow(SchemaFencedError),
        );

        expect(await stateAdapter.getWorkers({ workerIds: [workerId] })).toEqual([undefined]);
      },
    },
    {
      name: "extendWorkerLease fails with SchemaFencedError once its writes are fenced, leaving the lease unchanged",
      run: async ({ stateAdapter, withWritesFenced }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["fenced-lease"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const before = await stateAdapter.getWorkers({ workerIds: [worker.id] });

        await withWritesFenced(async () =>
          expect(
            stateAdapter.extendWorkerLease({
              workerId: worker.id,
              workerToken: worker.token,
              leaseMs: 120_000,
            }),
          ).rejects.toThrow(SchemaFencedError),
        );

        expect(await stateAdapter.getWorkers({ workerIds: [worker.id] })).toEqual(before);
      },
    },
    {
      name: "startJobAttempts fails with SchemaFencedError once its writes are fenced, leaving the job pending",
      run: async ({ stateAdapter, withWritesFenced }, expect) => {
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
          expect(
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["fenced-start-attempt"],
              limit: 1,
            }),
          ).rejects.toThrow(SchemaFencedError),
        );

        expect(await stateAdapter.getJobs({ jobIds: [chain.head.id] })).toEqual(before);
      },
    },
    {
      name: "completeJobs fails with SchemaFencedError once its writes are fenced, leaving the job unchanged",
      run: async ({ stateAdapter, withWritesFenced }, expect) => {
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
          expect(
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.completeJobs({ txCtx, jobs: [{ jobId: chain.head.id, output: null }] }),
            ),
          ).rejects.toThrow(SchemaFencedError),
        );

        expect(await stateAdapter.getJobs({ jobIds: [chain.head.id] })).toEqual(before);
      },
    },
    {
      name: "rescheduleJobs fails with SchemaFencedError once its writes are fenced, leaving the job unchanged",
      run: async ({ stateAdapter, withWritesFenced }, expect) => {
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
          expect(
            stateAdapter.rescheduleJobs({
              jobs: [{ jobId: chain.head.id, schedule: { afterMs: 60_000 } }],
            }),
          ).rejects.toThrow(SchemaFencedError),
        );

        expect(await stateAdapter.getJobs({ jobIds: [chain.head.id] })).toEqual(before);
      },
    },
    {
      name: "reads and deletes chains while writes are fenced",
      run: async ({ stateAdapter, withWritesFenced }, expect) => {
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
          expect(job?.id).toBe(chain.head.id);
          const [deleted] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [chain.id] }),
          );
          expect((deleted as StateChain).id).toBe(chain.id);
        });

        expect(await stateAdapter.getJobs({ jobIds: [chain.head.id] })).toEqual([undefined]);
      },
    },
  ],
};

export const schemaFenceConcurrentTransactionsGroup: ConformanceGroup<SchemaFenceConformanceFixture> =
  {
    name: "schemaFence",
    cases: [
      {
        name: "fails a write with SchemaFencedError when its writes are fenced after the transaction began",
        run: async ({ stateAdapter, withWritesFenced }, expect) => {
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

          await expect(
            stateAdapter.withTransaction(async (txCtx) => {
              await stateAdapter.getJobs({ txCtx, jobIds: [chain.head.id] });
              await withWritesFenced(async () =>
                stateAdapter.createJobs({
                  txCtx,
                  jobs: [{ id: fencedJobId, typeName: "fenced-open-tx", input: null }],
                }),
              );
            }),
          ).rejects.toThrow(SchemaFencedError);

          expect(await stateAdapter.getJobs({ jobIds: [fencedJobId] })).toEqual([undefined]);
        },
      },
      {
        name: "commits a transaction that already wrote before its writes are fenced",
        run: async ({ stateAdapter, withWritesFenced }, expect) => {
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
            expect(dropped).toBe(false);
          });

          const [job] = (await readAfterDrop) as ({ id: string } | undefined)[];
          expect(job?.id).toBe(jobId);
        },
      },
    ],
  };
