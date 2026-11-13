// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { randomUUID } from "node:crypto";

import { acquireMysql } from "@queuert/testcontainers";
import { type Pool, type RowDataPacket, createPool } from "mysql2/promise";
import { it as baseIt, describe, expect } from "vitest";

import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import {
  type Mysql2PoolProvider,
  createMysql2PoolProvider,
} from "../state-provider/state-provider.mysql2-pool.ts";

const INSTALLED = { applied: ["001_initial_schema"], skipped: [], reverted: [], unrecognized: [] };
const UP_TO_DATE = { applied: [], skipped: ["001_initial_schema"], reverted: [], unrecognized: [] };

const SCHEMA_STATEMENT =
  /^\s*CREATE TABLE IF NOT EXISTS queuert_(job|job_blocker|worker|schema_fence_v1)\b/;

const schemaShape = async (pool: Pool): Promise<string[]> => {
  const [tables] = await pool.query<RowDataPacket[]>(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name",
  );
  const definitions: string[] = [];
  for (const { name } of tables) {
    const [[row]] = await pool.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${name as string}\``);
    definitions.push(row["Create Table"] as string);
  }
  return definitions;
};

const killedAfterSchemaStatements = (
  stateProvider: Mysql2PoolProvider,
  count: number,
): Mysql2PoolProvider => {
  const executed: string[] = [];
  return {
    ...stateProvider,
    executeSql: async (options) => {
      if (SCHEMA_STATEMENT.test(options.sql)) {
        if (executed.length === count) throw new Error("process killed");
        executed.push(options.sql);
      }
      return stateProvider.executeSql(options);
    },
  };
};

const defineMysqlMigrationSuite = async ({
  image,
  dialect,
  callerId,
}: {
  image: string;
  dialect: "mysql" | "mariadb";
  callerId: string;
}): Promise<void> => {
  await acquireMysql(image, callerId);

  const it = baseIt.extend("createDatabase", async ({}, { onCleanup }) => {
    const pools: Pool[] = [];
    onCleanup(async () => {
      await Promise.all(pools.map(async (pool) => pool.end()));
    });
    return async () => {
      const { connectionOptions } = await acquireMysql(image, `${callerId}-${randomUUID()}`);
      const createPoolForDatabase = () => {
        const pool = createPool({ ...connectionOptions, connectionLimit: 5 });
        pools.push(pool);
        return pool;
      };
      const shapePool = createPoolForDatabase();
      return {
        createAdapter: (wrap = (provider: Mysql2PoolProvider) => provider) =>
          createMysqlStateAdapter({
            stateProvider: wrap(createMysql2PoolProvider({ pool: createPoolForDatabase() })),
            dialect,
          }),
        shape: async () => schemaShape(shapePool),
      };
    };
  });

  describe(`${image} migrateToLatest`, () => {
    it("installs the schema once and then reports it up to date", async ({ createDatabase }) => {
      const database = await createDatabase();
      const adapter = database.createAdapter();

      expect(await adapter.migrateToLatest()).toEqual(INSTALLED);
      expect(await adapter.migrateToLatest()).toEqual(UP_TO_DATE);
    });

    it.for([0, 1, 2, 3])(
      "resumes a run killed after %i schema statements to the same schema",
      async (count, { createDatabase }) => {
        const reference = await createDatabase();
        await reference.createAdapter().migrateToLatest();
        const interrupted = await createDatabase();

        await expect(
          interrupted
            .createAdapter((provider) => killedAfterSchemaStatements(provider, count))
            .migrateToLatest(),
        ).rejects.toThrow("process killed");
        expect(await interrupted.createAdapter().migrateToLatest()).toEqual(INSTALLED);
        expect(await interrupted.shape()).toEqual(await reference.shape());
      },
    );

    it("lets one of two concurrent migrators install the schema", async ({ createDatabase }) => {
      const database = await createDatabase();

      const results = await Promise.all([
        database.createAdapter().migrateToLatest(),
        database.createAdapter().migrateToLatest(),
      ]);

      expect(results).toEqual(expect.arrayContaining([INSTALLED, UP_TO_DATE]));
    });
  });
};

// NOTE: hack for vitest plugin
baseIt("index");

for (const { image, dialect } of [
  { image: "mysql:8.4", dialect: "mysql" as const },
  { image: "mariadb:11.4", dialect: "mariadb" as const },
]) {
  await defineMysqlMigrationSuite({ image, dialect, callerId: `${import.meta.url}-${dialect}` });
}
