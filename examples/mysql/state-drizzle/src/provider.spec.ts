import {
  createMysqlMigratorConformanceContext,
  createMysqlStateProviderConformanceContext,
} from "@queuert/mysql/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { drizzle } from "drizzle-orm/mysql2";
import { type Pool, createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createDrizzleMysqlStateProvider } from "./provider.ts";

// #region conformance
describe("mysql/state-drizzle provider conformance", () => {
  let pool: Pool;
  let db: Parameters<typeof createDrizzleMysqlStateProvider>[0]["db"];
  const { context, cases } = createMysqlStateProviderConformanceContext({
    createStateProvider: async () => createDrizzleMysqlStateProvider({ db }),
    dialect: "mysql",
    isolationLevel: "REPEATABLE READ",
    withNonTransactionContext: async (fn) => fn({ tx: db }),
  });

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", import.meta.url);
    pool = createPool({ ...connectionOptions, connectionLimit: 20 });
    db = drizzle(pool, { schema: {}, mode: "default" });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("mysql/state-drizzle migrator conformance", () => {
  let pool: Pool;
  const { context, cases } = createMysqlMigratorConformanceContext({
    createStateProvider: () =>
      createDrizzleMysqlStateProvider({
        db: drizzle(pool, { schema: {}, mode: "default" }),
      }),
  });

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", `${import.meta.url}#migrator`);
    pool = createPool({ ...connectionOptions, connectionLimit: 10 });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
