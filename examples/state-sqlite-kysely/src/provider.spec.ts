import {
  createSqliteMigratorConformanceContext,
  createSqliteStateProviderConformanceContext,
  type SqliteStateProviderConformanceContext,
  sqliteMigratorConformanceCases,
  sqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createKyselySqliteStateProvider } from "./provider.ts";

type Database = Record<string, never>;

// #region conformance
describe("state-sqlite-kysely provider conformance", () => {
  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
  });
  let context: SqliteStateProviderConformanceContext;

  beforeAll(async () => {
    context = await createSqliteStateProviderConformanceContext({
      createStateProvider: async () => createKyselySqliteStateProvider({ db }),
      withNonTransactionContext: async (fn) => fn({ db }),
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  for (const conformanceCase of sqliteStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("state-sqlite-kysely migrator conformance", () => {
  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
  });
  const context = createSqliteMigratorConformanceContext({
    stateProvider: createKyselySqliteStateProvider({ db }),
  });

  afterAll(async () => {
    await db.destroy();
  });

  for (const conformanceCase of sqliteMigratorConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
