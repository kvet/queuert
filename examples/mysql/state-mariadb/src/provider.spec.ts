import {
  createMysqlMigratorConformanceContext,
  createMysqlStateProviderConformanceContext,
} from "@queuert/mysql/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { type Pool, createPool } from "mariadb";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createMariadbPoolStateProvider } from "./provider.ts";

// #region conformance
describe("mysql/state-mariadb provider conformance", () => {
  let pool: Pool;
  const { context, cases } = createMysqlStateProviderConformanceContext({
    createStateProvider: async () => createMariadbPoolStateProvider({ pool }),
    dialect: "mariadb",
    isolationLevel: "REPEATABLE READ",
    withNonTransactionContext: async (fn) => {
      const connection = await pool.getConnection();
      try {
        return await fn({ connection });
      } finally {
        await connection.release();
      }
    },
  });

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mariadb:13", import.meta.url);
    pool = createPool({ ...connectionOptions, connectionLimit: 20 });
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

describe("mysql/state-mariadb migrator conformance", () => {
  let pool: Pool;
  const { context, cases } = createMysqlMigratorConformanceContext({
    createStateProvider: () => createMariadbPoolStateProvider({ pool }),
  });

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mariadb:13", `${import.meta.url}#migrator`);
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
