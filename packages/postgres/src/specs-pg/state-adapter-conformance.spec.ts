import { type UUID } from "node:crypto";

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

const it = extendWithResourceLeakDetection(extendWithPostgres(baseIt, import.meta.url), {
  additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES,
});

it("index");

describe("PostgreSQL State Adapter Conformance", () => {
  const conformanceIt = it.extend<{
    pool: Pool;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    poisonTransaction: (txCtx: { $test: true }) => Promise<void>;
  }>({
    pool: [
      async ({ postgresConnectionString }, use) => {
        const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
        await use(pool);
        await pool.end();
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
    poisonTransaction: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(async (txCtx: { $test: true }) => {
          const pgCtx = txCtx as unknown as PgPoolContext;
          await pgCtx.poolClient.query("SELECT 1 FROM nonexistent_table_queuert_poison_xyz");
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
      idDefault: "'job.' || gen_random_uuid()::text",
      $idType: undefined as unknown as `job.${UUID}`,
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
    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();

              return complete(async () => ({ bar: 42 }));
            },
          },
        },
      }),
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

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (poolClient) =>
        client.startChain({
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
