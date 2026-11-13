import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const extendWorkerLeaseGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "extendWorkerLease",
  cases: [
    {
      name: "renews a live worker's lease to leaseMs from now",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const started = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["render-invoice-pdf"],
          concurrency: 3,
          leaseMs: 10_000,
        });

        const before = Date.now();
        const renewed = await stateAdapter.extendWorkerLease({
          workerId: started.id,
          workerToken: started.token,
          leaseMs: 120_000,
        });
        const after = Date.now();

        assert.equal(renewed!.id, started.id);
        assert.deepEqual(renewed!.typeNames, ["render-invoice-pdf"]);
        assert.equal(renewed!.concurrency, 3);
        assert.equal(renewed!.startedAt.getTime(), started.startedAt.getTime());
        assert.ok(renewed!.leaseUntil.getTime() >= before + 120_000 - 1_000);
        assert.ok(renewed!.leaseUntil.getTime() <= after + 120_000 + 1_000);
      },
    },
    {
      name: "renews inside a transaction",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: [],
          concurrency: 1,
          leaseMs: 10_000,
        });

        const renewed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendWorkerLease({
            txCtx,
            workerId: worker.id,
            workerToken: worker.token,
            leaseMs: 60_000,
          }),
        );

        assert.equal(renewed!.id, worker.id);
      },
    },
    {
      name: "an expired lease cannot be renewed",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: [],
          concurrency: 1,
          leaseMs: 1,
        });
        await sleep(20);

        assert.equal(
          await stateAdapter.extendWorkerLease({
            workerId: worker.id,
            workerToken: worker.token,
            leaseMs: 60_000,
          }),
          undefined,
        );
      },
    },
    {
      name: "returns undefined for a stale registration of the worker",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const workerId = stateAdapter.config.generateWorkerId();
        const staleRun = await stateAdapter.startWorker({
          workerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 10_000,
        });
        await stateAdapter.stopWorker({ workerId, workerToken: staleRun.token });
        await sleep(5);
        const currentRun = await stateAdapter.startWorker({
          workerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 10_000,
        });
        assert.notEqual(currentRun.startedAt.getTime(), staleRun.startedAt.getTime());

        assert.equal(
          await stateAdapter.extendWorkerLease({
            workerId,
            workerToken: staleRun.token,
            leaseMs: 120_000,
          }),
          undefined,
        );
        const [stored] = await stateAdapter.getWorkers({ workerIds: [workerId] });
        assert.equal(stored!.leaseUntil.getTime(), currentRun.leaseUntil.getTime());

        const renewed = await stateAdapter.extendWorkerLease({
          workerId,
          workerToken: currentRun.token,
          leaseMs: 120_000,
        });
        assert.equal(renewed!.id, workerId);
        assert.equal(renewed!.startedAt.getTime(), currentRun.startedAt.getTime());
        assert.ok(renewed!.leaseUntil.getTime() > currentRun.leaseUntil.getTime());
      },
    },
    {
      name: "a missing worker renews to undefined",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        assert.equal(
          await stateAdapter.extendWorkerLease({
            workerId: stateAdapter.config.generateWorkerId(),
            workerToken: crypto.randomUUID(),
            leaseMs: 60_000,
          }),
          undefined,
        );
      },
    },
  ],
};

export const extendWorkerLeaseConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "extendWorkerLease",
    cases: [
      {
        name: "a renewal issued while a claim of the same worker is open completes once the claim commits",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const worker = await stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["lease-open-claim"],
            concurrency: 1,
            leaseMs: 60_000,
          });
          const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "lease-open-claim",
                  input: null,
                },
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
              typeNames: ["lease-open-claim"],
              limit: 1,
            });
            claimed.resolve();
            await releaseClaim.promise;
            return jobs;
          });
          await claimed.promise;

          const renewal = stateAdapter.extendWorkerLease({
            workerId: worker.id,
            workerToken: worker.token,
            leaseMs: 120_000,
          });
          await sleep(100);
          releaseClaim.resolve();

          assert.deepEqual(
            (await claimTx).map((job) => job.id),
            [chain.head.id],
          );
          const renewed = await renewal;
          assert.ok(renewed!.leaseUntil.getTime() > worker.leaseUntil.getTime());
          const [stored] = await stateAdapter.getJobs({ jobIds: [chain.head.id] });
          assert.equal(stored!.status, "running");
          assert.equal(stored!.attemptBy, worker.id);
        },
      },
      {
        name: "concurrent claims, renewals and a reclaim of one worker settle without deadlock",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const worker = await stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["lease-contention"],
            concurrency: 1,
            leaseMs: 60_000,
          });
          const chains = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: Array.from({ length: 40 }, () => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "lease-contention",
                input: null,
              })),
            }),
          );
          await stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["lease-contention"],
            limit: 4,
          });

          const results = await Promise.allSettled([
            ...Array.from({ length: 8 }, async () =>
              stateAdapter.startJobAttempts({
                workerId: worker.id,
                workerToken: worker.token,
                typeNames: ["lease-contention"],
                limit: 2,
              }),
            ),
            ...Array.from({ length: 8 }, async () =>
              stateAdapter.extendWorkerLease({
                workerId: worker.id,
                workerToken: worker.token,
                leaseMs: 60_000,
              }),
            ),
            stateAdapter.withTransaction(async (txCtx) => {
              await stateAdapter.getWorkers({ txCtx, workerIds: [worker.id], lock: "exclusive" });
              const { items } = await stateAdapter.listWorkerJobs({
                txCtx,
                workerId: worker.id,
                orderDirection: "asc",
                page: { limit: 100 },
              });
              const running = items.filter(
                (job) => job.status === "running" && job.attemptBy === worker.id,
              );
              if (running.length === 0) return;
              await stateAdapter.rescheduleJobs({
                txCtx,
                jobs: running.map((job) => ({ jobId: job.id, attemptToken: job.attemptToken! })),
              });
            }),
          ]);
          assert.deepEqual(
            results.filter((result) => result.status === "rejected"),
            [],
          );

          const renewed = await stateAdapter.extendWorkerLease({
            workerId: worker.id,
            workerToken: worker.token,
            leaseMs: 60_000,
          });
          assert.ok(renewed!.leaseUntil.getTime() > worker.leaseUntil.getTime());
          const stored = await stateAdapter.getJobs({ jobIds: chains.map((chain) => chain.id) });
          assert.ok(
            stored.every(
              (job) =>
                job!.status === "pending" ||
                (job!.status === "running" && job!.attemptBy === worker.id),
            ),
          );
        },
      },
    ],
  };
