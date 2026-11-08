import { type UUID, randomUUID } from "node:crypto";

import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import { Pool, type PoolClient } from "pg";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";
import { extendWithResourceLeakDetection, withWorkerRunners } from "queuert/testing";
import { it as baseIt, expectTypeOf, vi } from "vitest";

import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.ts";
import { createPgPoolNotifyProvider } from "../notify-provider/notify-provider.pg-pool.ts";
import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import { createPgPoolProvider } from "../state-provider/state-provider.pg-pool.ts";

const it = extendWithResourceLeakDetection(
  extendWithPostgres(baseIt, import.meta.url, { expectedTestContexts: 1 }),
  {
    additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES,
  },
);

it("index");

it("infers custom ID types through the full stack", async ({ postgresConnectionString }) => {
  const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });

  try {
    const stateProvider = createPgPoolProvider({ pool });
    const stateAdapter = createPgStateAdapter({
      stateProvider,
      jobIdType: "text",
      generateJobId: (): `job.${UUID}` => `job.${randomUUID()}`,
    });

    await stateAdapter.migrateToLatest();

    const notifyProvider = createPgPoolNotifyProvider({ pool });
    const notifyAdapter = createPgNotifyAdapter({
      notifyProvider,
      channelPrefix: `spec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });

    const log = vi.fn();
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { foo: string };
        output: { bar: number };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypes,
    });
    const withTransaction = async <T>(fn: (poolClient: PoolClient) => Promise<T>): Promise<T> => {
      const poolClient = await pool.connect();
      try {
        await poolClient.query("BEGIN");
        const result = await fn(poolClient);
        await poolClient.query("COMMIT");
        return result;
      } catch (error) {
        await poolClient.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        poolClient.release();
      }
    };

    const workerRunner = createWorkerRunner({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete, fence }) => {
              expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();
              expectTypeOf(fence).parameter(0).toEqualTypeOf<{ poolClient: PoolClient }>();

              await withTransaction(async (poolClient) => fence({ poolClient }));

              return withTxHooks(async (txHooks) =>
                withTransaction(async (poolClient) => {
                  await fence({ poolClient });
                  return complete({ poolClient, txHooks, output: { bar: 42 } });
                }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTxHooks(async (txHooks) =>
      withTransaction(async (poolClient) =>
        client.createChain({
          poolClient,
          txHooks,
          typeName: "test",
          input: { foo: "hello" },
        }),
      ),
    );
    expectTypeOf(chain.id).toEqualTypeOf<`job.${UUID}`>();

    await withWorkerRunners([await workerRunner.start()], async () => {
      await client.awaitChain(chain, { timeoutMs: 1000 });
    });
  } finally {
    await pool.end();
  }
});
