import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  JobAlreadyCompletedError,
} from "queuert";
import {
  extendWithCommon,
  extendWithNotifyNoop,
  extendWithResourceLeakDetection,
} from "queuert/testing";
import { it } from "vitest";

import { type PgPoolContext } from "../state-provider/state-provider.pg-pool.js";
import { extendWithStatePg } from "./state-adapter.pg.spec-helper.js";

const postgresIt = extendWithResourceLeakDetection(
  extendWithNotifyNoop(
    extendWithCommon(extendWithStatePg(extendWithPostgres(it, import.meta.url))),
  ),
  { additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES },
);

const completionOptions = { pollIntervalMs: 100, timeoutMs: 5000 };
const slowBackoff = { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 };

postgresIt(
  "reschedules the attempt when finish is rolled back in a user savepoint and the outer transaction commits",
  async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: null };
    }>();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        backoffConfig: slowBackoff,
        processors: {
          test: {
            attemptHandler: async ({ finish }) =>
              withTransaction(async (txCtx, transactionHooks) => {
                const { poolClient } = txCtx as unknown as PgPoolContext;
                await poolClient.query("SAVEPOINT user_savepoint");
                const result = await finish({ ...txCtx, transactionHooks, output: null });
                await poolClient.query("ROLLBACK TO SAVEPOINT user_savepoint");
                return result;
              }),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await expect
        .poll(async () => (await client.getJob({ id: chain.id }))?.status, { timeout: 5000 })
        .toBe("pending");
    });

    const job = await client.getJob({ id: chain.id });
    expect(job?.lastAttemptError).toContain("Attempt handler returned without a committed finish");
  },
);

postgresIt(
  "rolls back the handler's own writes when finish loses ownership",
  async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    await withTransaction(async (txCtx) => {
      const { poolClient } = txCtx as unknown as PgPoolContext;
      await poolClient.query(
        "CREATE TABLE IF NOT EXISTS finish_side_effect (job_id text PRIMARY KEY)",
      );
      await poolClient.query("TRUNCATE finish_side_effect");
    });

    const jobTypes = defineJobTypes<{
      test: { entry: true; input: null; output: { by: string } };
    }>();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const { promise: started, resolve: onStarted } = Promise.withResolvers<void>();
    const { promise: takenOver, resolve: onTakenOver } = Promise.withResolvers<void>();
    let finishError: unknown;
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, finish }) => {
              onStarted();
              await takenOver;
              try {
                return await withTransaction(async (txCtx, transactionHooks) => {
                  const { poolClient } = txCtx as unknown as PgPoolContext;
                  await poolClient.query("INSERT INTO finish_side_effect (job_id) VALUES ($1)", [
                    job.id,
                  ]);
                  return finish({ ...txCtx, transactionHooks, output: { by: "worker" } });
                });
              } catch (error) {
                finishError = error;
                throw error;
              }
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "test", input: null }),
    );

    await withWorkers([await worker.start()], async () => {
      await started;
      await withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) =>
            completeJob(job, async ({ finish }) => finish({ output: { by: "workerless" } })),
        }),
      );
      onTakenOver();
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ by: "workerless" });
      await expect.poll(() => finishError, { timeout: 5000 }).toBeDefined();
    });

    expect(finishError).toBeInstanceOf(JobAlreadyCompletedError);
    const rows = await withTransaction(async (txCtx) => {
      const { poolClient } = txCtx as unknown as PgPoolContext;
      const result = await poolClient.query("SELECT job_id FROM finish_side_effect");
      return result.rows;
    });
    expect(rows).toEqual([]);
  },
);
