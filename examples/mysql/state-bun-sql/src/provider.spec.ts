import { afterAll, beforeAll, describe, test } from "bun:test";

import {
  createMysqlMigratorConformanceContext,
  createMysqlStateProviderConformanceContext,
  type MysqlMigratorConformanceContext,
  type MysqlStateProviderConformanceContext,
  mysqlMigratorConformanceCases,
  mysqlStateProviderConformanceCases,
} from "@queuert/mysql/conformance";
import { acquireMysql, type MysqlConnectionOptions } from "@queuert/testcontainers";
import { SQL } from "bun";

import { createBunSqlStateProvider } from "./provider.ts";

const createSql = ({ host, port, user, password, database }: MysqlConnectionOptions): SQL =>
  new SQL({
    adapter: "mysql",
    hostname: host,
    port,
    username: user,
    password,
    database,
    max: 10,
    allowPublicKeyRetrieval: true,
  });

// #region conformance
describe("mysql/state-bun-sql provider conformance", () => {
  let sql: SQL;
  let context: MysqlStateProviderConformanceContext;

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", import.meta.url);
    sql = createSql(connectionOptions);
    context = await createMysqlStateProviderConformanceContext({
      createStateProvider: async () => createBunSqlStateProvider({ sql }),
      dialect: "mysql",
      withNonTransactionContext: async (fn) => fn({ txSql: sql }),
    });
  }, 120_000);

  afterAll(async () => {
    await sql.close();
  });

  for (const conformanceCase of mysqlStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("mysql/state-bun-sql migrator conformance", () => {
  let sql: SQL;
  let context: MysqlMigratorConformanceContext;

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", `${import.meta.url}#migrator`);
    sql = createSql(connectionOptions);
    context = createMysqlMigratorConformanceContext({
      stateProvider: createBunSqlStateProvider({ sql }),
    });
  }, 120_000);

  afterAll(async () => {
    await sql.close();
  });

  for (const conformanceCase of mysqlMigratorConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
