import {
  createMysqlMigratorConformanceContext,
  createMysqlStateProviderConformanceContext,
  type MysqlMigratorConformanceContext,
  type MysqlStateProviderConformanceContext,
  mysqlMigratorConformanceCases,
  mysqlStateProviderConformanceCases,
} from "@queuert/mysql/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import knexFactory, { type Knex } from "knex";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createKnexMysqlStateProvider } from "./provider.ts";

// #region conformance
describe("mysql/state-knex provider conformance", () => {
  let knex: Knex;
  let context: MysqlStateProviderConformanceContext;

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", import.meta.url);
    knex = knexFactory({
      client: "mysql2",
      connection: connectionOptions,
      pool: { min: 0, max: 20 },
    });
    context = await createMysqlStateProviderConformanceContext({
      createStateProvider: async () => createKnexMysqlStateProvider({ knex }),
      dialect: "mysql",
      withNonTransactionContext: async (fn) => fn({ trx: knex }),
    });
  }, 120_000);

  afterAll(async () => {
    await knex.destroy();
  });

  for (const conformanceCase of mysqlStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("mysql/state-knex migrator conformance", () => {
  let knex: Knex;
  let context: MysqlMigratorConformanceContext;

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", `${import.meta.url}#migrator`);
    knex = knexFactory({
      client: "mysql2",
      connection: connectionOptions,
      pool: { min: 0, max: 10 },
    });
    context = createMysqlMigratorConformanceContext({
      stateProvider: createKnexMysqlStateProvider({ knex }),
    });
  }, 120_000);

  afterAll(async () => {
    await knex.destroy();
  });

  for (const conformanceCase of mysqlMigratorConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
