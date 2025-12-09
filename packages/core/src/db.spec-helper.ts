import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client, Pool, PoolClient } from "pg";
import { beforeAll, type TestAPI } from "vitest";

import { createHash } from "crypto";
import { migrateToLatest, prepareQueuertSchema } from "./index.js";
import { StateProvider } from "./state-provider/state-provider.js";
import { createPgPoolProvider, PgPoolProvider } from "./state-provider/state-provider.pg-pool.js";

const LABEL = "queuert-postgres-test";

export const extendWithDb = <T>(
  api: TestAPI<T>,
  reuseId: string,
): TestAPI<T & { stateProvider: PgPoolProvider }> => {
  const normalizedReuseId = createHash("sha1").update(reuseId).digest("hex");

  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:14")
      .withName("queuert-postgres-test")
      .withDatabase("base_database_for_tests")
      .withLabels({
        label: LABEL,
      })
      .withExposedPorts(5432)
      .withReuse()
      .start();
  }, 60_000);

  return api.extend<{
    _db: Pool;
    _dbMigrateToLatest: void;
    _dbCleanup: void;
    stateProvider: StateProvider<{ client: PoolClient }>;
  }>({
    _db: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const client = new Client({
          connectionString: container.getConnectionUri(),
        });

        await client.connect();

        await client.query(`DROP DATABASE IF EXISTS "${normalizedReuseId}";`);
        await client.query(
          `CREATE DATABASE "${normalizedReuseId}" WITH OWNER "${container.getUsername()}" TEMPLATE template0`,
        );

        await client.end();

        await use(
          new Pool({
            connectionString: container
              .getConnectionUri()
              .replace("base_database_for_tests", normalizedReuseId),
          }),
        );
      },
      { scope: "worker" },
    ],
    _dbMigrateToLatest: [
      async ({ _db }, use) => {
        const client = await _db.connect();
        await client.query(`DROP SCHEMA IF EXISTS queuert CASCADE;`).catch(() => {
          // ignore
        });
        client.release();

        const stateProvider = createPgPoolProvider({
          pool: _db,
        });
        await stateProvider.provideContext(async ({ client }) => {
          await prepareQueuertSchema({
            stateProvider,
            client,
          });
          await migrateToLatest({
            stateProvider,
            client,
          });
        });

        await use();
      },
      { scope: "worker" },
    ],
    _dbCleanup: [
      async ({ _db }, use) => {
        await use();

        const client = await _db.connect();
        await client.query(`DELETE FROM queuert.job_blocker;`);
        await client.query(`DELETE FROM queuert.job;`);
        client.release();
      },
      { scope: "test" },
    ],
    stateProvider: [
      ({ _db, _dbMigrateToLatest, _dbCleanup }, use) => {
        void _dbMigrateToLatest;
        void _dbCleanup;

        return use(
          createPgPoolProvider({
            pool: _db,
          }),
        );
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithDb<T>>;
};
