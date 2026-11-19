import {
  createMysqlMigratorConformanceCases,
  createMysqlStateProviderConformanceCases,
} from "@queuert/mysql/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { type Pool, createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createMysql2PoolStateProvider } from "./provider.ts";

// #region conformance
describe("mysql/state-mysql2 provider conformance", () => {
  let pool: Pool;
  const cases = createMysqlStateProviderConformanceCases({
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

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", import.meta.url);
    pool = createPool({ ...connectionOptions, connectionLimit: 20 });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion

describe("mysql/state-mysql2 migrator conformance", () => {
  let pool: Pool;
  const cases = createMysqlMigratorConformanceCases({
    createStateProvider: () => createMysql2PoolStateProvider({ pool }),
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
      await conformanceCase.run();
    });
  }
});
