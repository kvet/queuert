import { type UUID } from "node:crypto";

import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import {
  type StateAdapter,
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "queuert";
import {
  extendWithResourceLeakDetection,
  stateAdapterConformanceTestSuite,
  withWorkers,
} from "queuert/testing";
import { it as baseIt, describe, expectTypeOf, vi } from "vitest";

import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.js";
import { createPostgresJsNotifyProvider } from "../notify-provider/notify-provider.postgres-js.js";
import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import {
  type PostgresJsContext,
  createPostgresJsProvider,
} from "../state-provider/state-provider.postgres-js.js";

const it = extendWithResourceLeakDetection(extendWithPostgres(baseIt, import.meta.url), {
  additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES,
});

it("index");

describe("PostgreSQL State Adapter Conformance (postgres.js)", () => {
  const conformanceIt = it.extend<{
    sql: postgres.Sql;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    poisonTransaction: (txCtx: { $test: true }) => Promise<void>;
  }>({
    sql: [
      async ({ postgresConnectionString }, use) => {
        const sql = postgres(postgresConnectionString, { max: 10, onnotice: () => {} });
        await use(sql);
        await sql.end();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ sql }, use) => {
        await sql.unsafe(
          `DROP TABLE IF EXISTS queuert_job_blocker, queuert_job, queuert_migration CASCADE; DROP TYPE IF EXISTS queuert_job_status CASCADE`,
        );

        const stateProvider = createPostgresJsProvider({ sql });
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
          const pgCtx = txCtx as unknown as PostgresJsContext;
          await pgCtx.sql.unsafe("SELECT 1 FROM nonexistent_table_queuert_poison_xyz");
        });
      },
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});

it("infers custom ID types through the full stack", async ({ postgresConnectionString }) => {
  const sql = postgres(postgresConnectionString, { max: 10, onnotice: () => {} });

  try {
    const stateProvider = createPostgresJsProvider({ sql });
    const stateAdapter = await createPgStateAdapter({
      stateProvider,
      idType: "text",
      idDefault: "'job.' || gen_random_uuid()::text",
      $idType: undefined as unknown as `job.${UUID}`,
    });

    await stateAdapter.migrateToLatest();

    const notifyProvider = createPostgresJsNotifyProvider({ sql });
    const notifyAdapter = await createPgNotifyAdapter({
      notifyProvider,
      channelPrefix: `spec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });

    const log = vi.fn();
    const jobTypeRegistry = defineJobTypeRegistry<{
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
      jobTypeRegistry,
    });
    const worker = await createInProcessWorker({
      client,
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
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

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      sql.begin(async (txSql) =>
        client.startJobChain({
          sql: txSql,
          transactionHooks,
          typeName: "test",
          input: { foo: "hello" },
        }),
      ),
    );
    expectTypeOf(jobChain.id).toEqualTypeOf<`job.${UUID}`>();

    await withWorkers([await worker.start()], async () => {
      await client.awaitJobChain(jobChain, { timeoutMs: 1000 });
    });
  } finally {
    await sql.end();
  }
});
