import {
  createMysqlMigratorConformanceContext,
  createMysqlStateProviderConformanceContext,
  type MysqlMigratorConformanceContext,
  type MysqlStateProviderConformanceContext,
  mysqlMigratorConformanceCases,
  mysqlStateProviderConformanceCases,
} from "@queuert/mysql/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { drizzle } from "drizzle-orm/mysql2";
import { type Pool, createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createDrizzleMysqlStateProvider } from "./provider.ts";

// #region conformance
describe("mysql/state-drizzle provider conformance", () => {
  let pool: Pool;
  let context: MysqlStateProviderConformanceContext;

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", import.meta.url);
    pool = createPool({ ...connectionOptions, connectionLimit: 20 });
    const db = drizzle(pool, { schema: {}, mode: "default" });
    context = await createMysqlStateProviderConformanceContext({
      createStateProvider: async () => createDrizzleMysqlStateProvider({ db }),
      dialect: "mysql",
      withNonTransactionContext: async (fn) => fn({ tx: db }),
    });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  for (const conformanceCase of mysqlStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("mysql/state-drizzle migrator conformance", () => {
  let pool: Pool;
  let context: MysqlMigratorConformanceContext;

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", `${import.meta.url}#migrator`);
    pool = createPool({ ...connectionOptions, connectionLimit: 10 });
    context = createMysqlMigratorConformanceContext({
      stateProvider: createDrizzleMysqlStateProvider({
        db: drizzle(pool, { schema: {}, mode: "default" }),
      }),
    });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  for (const conformanceCase of mysqlMigratorConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
