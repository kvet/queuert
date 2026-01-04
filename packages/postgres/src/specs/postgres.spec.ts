import { createInProcessNotifyAdapter, createQueuert, defineUnionJobTypes } from "queuert";
import { extendWithPostgres } from "@queuert/testcontainers";
import { UUID } from "crypto";
import { Pool } from "pg";
import { it as baseIt, expectTypeOf, vi } from "vitest";
import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import { createPgPoolProvider } from "./state-provider.pg-pool.js";

const it = extendWithPostgres(baseIt, import.meta.url);

it("should infer types correctly with custom ID", async ({ postgresConnectionString }) => {
  const pool = new Pool({
    connectionString: postgresConnectionString,
  });

  const stateProvider = createPgPoolProvider({ pool });
  const stateAdapter = createPgStateAdapter({
    stateProvider,
    schema: "myapp",
    idType: "TEXT",
    idDefault: "concat('job.', gen_random_uuid())",
    $idType: undefined as unknown as `job.${UUID}`,
  });

  const poolClient = await pool.connect();
  await poolClient.query(`
    CREATE SCHEMA IF NOT EXISTS myapp;
    GRANT USAGE ON SCHEMA myapp TO test;
  `);
  await stateAdapter.migrateToLatest({ poolClient });
  poolClient.release();

  const queuert = await createQueuert({
    stateAdapter,
    notifyAdapter: createInProcessNotifyAdapter(),
    log: vi.fn(),
    jobTypeDefinitions: defineUnionJobTypes<{
      test: {
        input: { foo: string };
        output: { bar: number };
      };
    }>(),
  });

  const jobSequence = await queuert.withNotify(async () => {
    const poolClient = await pool.connect();
    await poolClient.query("BEGIN");
    try {
      return await queuert.startJobSequence({
        poolClient,
        firstJobTypeName: "test",
        input: { foo: "hello" },
      });
    } finally {
      await poolClient.query("COMMIT");
      poolClient.release();
    }
  });
  expectTypeOf(jobSequence.id).toEqualTypeOf<`job.${UUID}`>();

  const worker = queuert.createWorker().implementJobType({
    name: "test",
    process: async ({ job, complete }) => {
      expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();

      return complete(async () => ({ bar: 42 }));
    },
  });

  const stopWorker = await worker.start();

  await queuert.waitForJobSequenceCompletion({ ...jobSequence, timeoutMs: 1000 });

  await stopWorker();

  await pool.end();
});
