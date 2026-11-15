import {
  createMysqlMigratorConformanceContext,
  createMysqlStateProviderConformanceContext,
  type MysqlMigratorConformanceContext,
  type MysqlStateProviderConformanceContext,
  mysqlMigratorConformanceCases,
  mysqlStateProviderConformanceCases,
} from "@queuert/mysql/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { type Pool, createPool } from "mariadb";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createMariadbPoolStateProvider } from "./provider.ts";

// #region conformance
describe("mysql/state-mariadb provider conformance", () => {
  let pool: Pool;
  let context: MysqlStateProviderConformanceContext;

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mariadb:13", import.meta.url);
    pool = createPool({ ...connectionOptions, connectionLimit: 20 });
    context = await createMysqlStateProviderConformanceContext({
      createStateProvider: async () => createMariadbPoolStateProvider({ pool }),
      dialect: "mariadb",
      withNonTransactionContext: async (fn) => {
        const connection = await pool.getConnection();
        try {
          return await fn({ connection });
        } finally {
          await connection.release();
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

describe("mysql/state-mariadb migrator conformance", () => {
  let pool: Pool;
  let context: MysqlMigratorConformanceContext;

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mariadb:13", `${import.meta.url}#migrator`);
    pool = createPool({ ...connectionOptions, connectionLimit: 10 });
    context = createMysqlMigratorConformanceContext({
      stateProvider: createMariadbPoolStateProvider({ pool }),
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
