import {
  createMysqlMigratorConformanceCases,
  createMysqlStateProviderConformanceCases,
} from "@queuert/mysql/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import knexFactory, { type Knex } from "knex";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createKnexMysqlStateProvider } from "./provider.ts";

// #region conformance
describe("mysql/state-knex provider conformance", () => {
  let knex: Knex;
  const cases = createMysqlStateProviderConformanceCases({
    createStateProvider: async () => createKnexMysqlStateProvider({ knex }),
    dialect: "mysql",
    withNonTransactionContext: async (fn) => fn({ trx: knex }),
  });

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", import.meta.url);
    knex = knexFactory({
      client: "mysql2",
      connection: connectionOptions,
      pool: { min: 0, max: 20 },
    });
  }, 120_000);

  afterAll(async () => {
    await knex.destroy();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion

describe("mysql/state-knex migrator conformance", () => {
  let knex: Knex;
  const cases = createMysqlMigratorConformanceCases({
    createStateProvider: () => createKnexMysqlStateProvider({ knex }),
  });

  beforeAll(async () => {
    const { connectionOptions } = await acquireMysql("mysql:26", `${import.meta.url}#migrator`);
    knex = knexFactory({
      client: "mysql2",
      connection: connectionOptions,
      pool: { min: 0, max: 10 },
    });
  }, 120_000);

  afterAll(async () => {
    await knex.destroy();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
