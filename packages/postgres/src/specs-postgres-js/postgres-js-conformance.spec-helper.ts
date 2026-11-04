import { type UUID, randomUUID } from "node:crypto";

import type postgres from "postgres";
import {
  type StateAdapter,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";
import {
  type NotifyConformanceFixture,
  notifyAdapterConformanceTestSuite,
  stateAdapterConformanceTestSuite,
  withWorkers,
} from "queuert/testing";
import { type TestAPI, describe, expectTypeOf, vi } from "vitest";

import { createPgNotifyAdapter } from "../notify-adapter/notify-adapter.pg.js";
import { createPostgresJsNotifyProvider } from "../notify-provider/notify-provider.postgres-js.js";
import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import { createPostgresJsProvider } from "../state-provider/state-provider.postgres-js.js";

/**
 * Creates a postgres.js client. The provider supports both postgres.js v3 and v4;
 * each spec file passes the `postgres` factory of the major version it covers.
 */
export type PostgresJsFactory = (
  connectionString: string,
  options: { max: number; onnotice: () => void },
) => postgres.Sql;

type PostgresIt = TestAPI<{ postgresConnectionString: string }>;

const connect = (createSql: PostgresJsFactory, connectionString: string): postgres.Sql =>
  createSql(connectionString, { max: 10, onnotice: () => {} });

export const postgresJsStateAdapterSpecs = ({
  it,
  createSql,
  label,
}: {
  it: PostgresIt;
  createSql: PostgresJsFactory;
  label: string;
}): void => {
  describe(`PostgreSQL State Adapter Conformance (${label})`, () => {
    const conformanceIt = it.extend<{
      sql: postgres.Sql;
      stateAdapter: StateAdapter<{ $test: true }, string>;
      transactionConcurrency: "concurrent" | "serialized";
      withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
    }>({
      sql: [
        async ({ postgresConnectionString }, use) => {
          const sql = connect(createSql, postgresConnectionString);
          await use(sql);
          await sql.end();
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
      withNonTransactionContext: [
        async ({ sql }, use) => {
          await use(async (fn) => fn({ txSql: sql } as unknown as { $test: true }));
        },
        { scope: "test" },
      ],
    });

    stateAdapterConformanceTestSuite({ it: conformanceIt });
  });

  it(`infers custom ID types through the full stack (${label})`, async ({
    postgresConnectionString,
  }) => {
    const sql = connect(createSql, postgresConnectionString);

    try {
      const stateProvider = createPostgresJsProvider({ sql });
      const stateAdapter = await createPgStateAdapter({
        stateProvider,
        idType: "text",
        generateId: (): `job.${UUID}` => `job.${randomUUID()}`,
      });

      await stateAdapter.migrateToLatest();

      const notifyProvider = createPostgresJsNotifyProvider({ sql });
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

                return withTransactionHooks(async (transactionHooks) =>
                  sql.begin(async (txSql) =>
                    complete({ txSql, transactionHooks, output: { bar: 42 } }),
                  ),
                );
              },
            },
          },
        }),
      });

      const chain = await withTransactionHooks(async (transactionHooks) =>
        sql.begin(async (txSql) =>
          client.createChain({
            txSql,
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
      await sql.end();
    }
  });
};

export const postgresJsNotifyAdapterSpecs = ({
  it,
  createSql,
  label,
}: {
  it: PostgresIt;
  createSql: PostgresJsFactory;
  label: string;
}): void => {
  describe(`PostgreSQL Notify Adapter Conformance (${label}) - Default Channel Prefix`, () => {
    const conformanceIt = it.extend<NotifyConformanceFixture>({
      notifyAdapter: [
        async ({ postgresConnectionString }, use) => {
          const sql = connect(createSql, postgresConnectionString);

          const notifyProvider = createPostgresJsNotifyProvider({ sql });
          const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

          await use(notifyAdapter);

          await sql.end();
        },
        { scope: "test" },
      ],
    });

    notifyAdapterConformanceTestSuite({ it: conformanceIt });
  });

  describe(`PostgreSQL Notify Adapter Conformance (${label}) - Custom Channel Prefix`, () => {
    const conformanceIt = it.extend<NotifyConformanceFixture>({
      notifyAdapter: [
        async ({ postgresConnectionString }, use) => {
          const sql = connect(createSql, postgresConnectionString);

          const notifyProvider = createPostgresJsNotifyProvider({ sql });
          const notifyAdapter = await createPgNotifyAdapter({
            notifyProvider,
            channelPrefix: "myapp_notifications",
          });

          await use(notifyAdapter);

          await sql.end();
        },
        { scope: "test" },
      ],
    });

    notifyAdapterConformanceTestSuite({ it: conformanceIt });
  });
};
