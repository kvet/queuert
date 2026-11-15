import {
  createMysqlMigratorConformanceContext,
  createMysqlStateProviderConformanceContext,
  type MysqlMigratorConformanceContext,
  type MysqlStateProviderConformanceContext,
  mysqlMigratorConformanceCases,
  mysqlStateProviderConformanceCases,
} from "@queuert/mysql/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { Kysely, MysqlDialect } from "kysely";
import { createPool } from "mysql2";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createKyselyMysqlStateProvider } from "./provider.ts";

type Database = Record<string, never>;

// #region conformance
describe("mysql/state-kysely provider conformance", () => {
  let db: Kysely<Database>;
  let context: MysqlStateProviderConformanceContext;

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", import.meta.url);
    const kysely = new Kysely<Database>({
      dialect: new MysqlDialect({
        pool: createPool({ ...connectionOptions, connectionLimit: 20 }),
      }),
    });
    db = kysely;
    context = await createMysqlStateProviderConformanceContext({
      createStateProvider: async () => createKyselyMysqlStateProvider({ db: kysely }),
      dialect: "mysql",
      withNonTransactionContext: async (fn) => fn({ db: kysely }),
    });
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
  });

  for (const conformanceCase of mysqlStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("mysql/state-kysely migrator conformance", () => {
  let db: Kysely<Database>;
  let context: MysqlMigratorConformanceContext;

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", `${import.meta.url}#migrator`);
    db = new Kysely<Database>({
      dialect: new MysqlDialect({
        pool: createPool({ ...connectionOptions, connectionLimit: 10 }),
      }),
    });
    context = createMysqlMigratorConformanceContext({
      stateProvider: createKyselyMysqlStateProvider({ db }),
    });
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
  });

  for (const conformanceCase of mysqlMigratorConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
