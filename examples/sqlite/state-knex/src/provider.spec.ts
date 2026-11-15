import {
  asyncSqliteStateProviderConformanceCases,
  createSqliteMigratorConformanceContext,
  createSqliteStateProviderConformanceContext,
  type SqliteStateProviderConformanceContext,
  sqliteMigratorConformanceCases,
  sqliteStateProviderConformanceCases,
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
  let context: SqliteStateProviderConformanceContext;

  beforeAll(async () => {
    context = await createSqliteStateProviderConformanceContext({
      createStateProvider: async () => createKnexSqliteStateProvider({ knex }),
      withNonTransactionContext: async (fn) => fn({ trx: knex }),
    });
  });

  afterAll(async () => {
    await knex.destroy();
  });

  for (const conformanceCase of [
    ...sqliteStateProviderConformanceCases,
    ...asyncSqliteStateProviderConformanceCases,
  ]) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
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
  const context = createSqliteMigratorConformanceContext({
    stateProvider: createKnexSqliteStateProvider({ knex }),
  });

  afterAll(async () => {
    await knex.destroy();
  });

  for (const conformanceCase of sqliteMigratorConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
