import {
  createMysqlMigratorConformanceContext,
  createMysqlStateProviderConformanceContext,
  type MysqlMigratorConformanceContext,
  type MysqlStateProviderConformanceContext,
  mysqlMigratorConformanceCases,
  mysqlStateProviderConformanceCases,
} from "@queuert/mysql/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { type Pool, createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createMysql2PoolStateProvider } from "./provider.ts";

// #region conformance
describe("state-mysql-mysql2 provider conformance", () => {
  let pool: Pool;
  let context: MysqlStateProviderConformanceContext;

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", import.meta.url);
    pool = createPool({ ...connectionOptions, connectionLimit: 20 });
    context = await createMysqlStateProviderConformanceContext({
      createStateProvider: async () => createMysql2PoolStateProvider({ pool }),
      dialect: "mysql",
      withNonTransactionContext: async (fn) => {
        const connection = await pool.getConnection();
        try {
          return await fn({ connection });
        } finally {
          connection.release();
        }
      },
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

describe("state-mysql-mysql2 migrator conformance", () => {
  let pool: Pool;
  let context: MysqlMigratorConformanceContext;

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", `${import.meta.url}#migrator`);
    pool = createPool({ ...connectionOptions, connectionLimit: 10 });
    context = createMysqlMigratorConformanceContext({
      stateProvider: createMysql2PoolStateProvider({ pool }),
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
