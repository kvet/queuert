import { type UUID, randomUUID } from "node:crypto";

import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import { Pool, type PoolClient } from "pg";
import {
  type StateAdapter,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";
import {
  extendWithResourceLeakDetection,
  stateAdapterConformanceTestSuite,
  withWorkers,
} from "queuert/testing";
import { it as baseIt, describe, expectTypeOf, vi } from "vitest";

import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.js";
import { createPgPoolNotifyProvider } from "../notify-provider/notify-provider.pg-pool.js";
import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.js";

const it = extendWithResourceLeakDetection(
  extendWithPostgres(baseIt, import.meta.url, { expectedTestContexts: 2 }),
  {
    additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES,
  },
);

it("index");

describe("PostgreSQL State Adapter Conformance", () => {
  const conformanceIt = it.extend<{
    pool: Pool;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    transactionConcurrency: "concurrent" | "serialized";
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
  }>({
    pool: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
        await use(pool);
        await pool.end();
      },
      { scope: "test" },
    ],
    transactionConcurrency: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use("concurrent");
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ pool }, use) => {
        const client = await pool.connect();
        await client
          .query(
            `DROP TABLE IF EXISTS queuert_job_blocker, queuert_job, queuert_migration CASCADE; DROP TYPE IF EXISTS queuert_job_status CASCADE`,
          )
          .catch(() => {});
        client.release();

        const stateProvider = createPgPoolProvider({ pool });
        const adapter = await createPgStateAdapter({ stateProvider });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
    withNonTransactionContext: [
      async ({ pool }, use) => {
        await use(async (fn) => {
          const poolClient = await pool.connect();
          try {
            const pgCtx: PgPoolContext = { poolClient };
            return await fn(pgCtx as unknown as { $test: true });
          } finally {
            poolClient.release();
          }
        });
      },
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});

it("infers custom ID types through the full stack", async ({ postgresConnectionString }) => {
  const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });

  try {
    const stateProvider = createPgPoolProvider({ pool });
    const stateAdapter = await createPgStateAdapter({
      stateProvider,
      idType: "text",
      generateId: (): `job.${UUID}` => `job.${randomUUID()}`,
    });

    await stateAdapter.migrateToLatest();

    const notifyProvider = createPgPoolNotifyProvider({ pool });
    const notifyAdapter = await createPgNotifyAdapter({
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

    const client = await createClient({
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

    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();

              return withTransactionHooks(async (transactionHooks) =>
                withTransaction(async (poolClient) =>
                  complete({ poolClient, transactionHooks, output: { bar: 42 } }),
                ),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (poolClient) =>
        client.createChain({
          poolClient,
          transactionHooks,
          typeName: "test",
          input: { foo: "hello" },
        }),
      ),
    );
    expectTypeOf(chain.id).toEqualTypeOf<`job.${UUID}`>();

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, { timeoutMs: 1000 });
    });
  } finally {
    await pool.end();
  }
});
