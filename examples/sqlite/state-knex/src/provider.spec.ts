import {
  createSqliteMigratorConformanceCases,
  createSqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";
import knexFactory from "knex";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createKnexSqliteStateProvider } from "./provider.ts";

// #region conformance
describe("sqlite/state-knex provider conformance", () => {
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
  const cases = createSqliteStateProviderConformanceCases({
    mode: "async",
    createStateProvider: async () => createKnexSqliteStateProvider({ knex }),
    withNonTransactionContext: async (fn) => fn({ trx: knex }),
  });

  beforeAll(async () => {});

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

describe("sqlite/state-knex migrator conformance", () => {
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
  const cases = createSqliteMigratorConformanceCases({
    mode: "async",
    createStateProvider: () => createKnexSqliteStateProvider({ knex }),
  });

  afterAll(async () => {
    await knex.destroy();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
