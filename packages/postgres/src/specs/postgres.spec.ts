import { TESTCONTAINER_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import { type UUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { createClient, createInProcessWorker, defineJobTypes, withCommitHooks } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { extendWithResourceLeakDetection, withWorkers } from "queuert/testing";
import { it as baseIt, expectTypeOf, vi } from "vitest";
import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import { createPgPoolProvider } from "./state-provider.pg-pool.js";

const it = extendWithResourceLeakDetection(extendWithPostgres(baseIt, import.meta.url), {
  additionalAllowedTypes: TESTCONTAINER_RESOURCE_TYPES,
});

it("index");

it("should infer types correctly with custom ID", async ({ postgresConnectionString }) => {
  const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });

  try {
    const stateProvider = createPgPoolProvider({ pool });
    const stateAdapter = await createPgStateAdapter({
      stateProvider,
      idType: "text",
      idDefault: "'job.' || gen_random_uuid()::text",
      $idType: undefined as unknown as `job.${UUID}`,
    });

    await stateProvider.executeSql({
      sql: "CREATE SCHEMA IF NOT EXISTS queuert;",
    });
    await stateAdapter.migrateToLatest();

    const notifyAdapter = createInProcessNotifyAdapter();
    const log = vi.fn();
    const registry = defineJobTypes<{
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
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      log,
      registry,
      processors: {
        test: {
          attemptHandler: async ({ job, complete }) => {
            expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();

            return complete(async () => ({ bar: 42 }));
          },
        },
      },
    });

    const runInTransaction = async <T>(fn: (poolClient: PoolClient) => Promise<T>): Promise<T> => {
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

    const jobChain = await withCommitHooks(async (commitHooks) =>
      runInTransaction(async (poolClient) =>
        client.startJobChain({
          poolClient,
          commitHooks,
          typeName: "test",
          input: { foo: "hello" },
        }),
      ),
    );
    expectTypeOf(jobChain.id).toEqualTypeOf<`job.${UUID}`>();

    await withWorkers([await worker.start()], async () => {
      await client.waitForJobChainCompletion(jobChain, { timeoutMs: 1000 });
    });
  } finally {
    await pool.end();
  }
});
