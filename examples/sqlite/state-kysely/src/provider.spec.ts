import {
  createSqliteMigratorConformanceContext,
  createSqliteStateProviderConformanceContext,
} from "@queuert/sqlite/conformance";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createKyselySqliteStateProvider } from "./provider.ts";

type Database = Record<string, never>;

// #region conformance
describe("sqlite/state-kysely provider conformance", () => {
  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
  });
  const { context, cases } = createSqliteStateProviderConformanceContext({
    mode: "async",
    createStateProvider: async () => createKyselySqliteStateProvider({ db }),
    withNonTransactionContext: async (fn) => fn({ db }),
  });

  beforeAll(async () => {});

  afterAll(async () => {
    await db.destroy();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("sqlite/state-kysely migrator conformance", () => {
  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
  });
  const { context, cases } = createSqliteMigratorConformanceContext({
    mode: "async",
    createStateProvider: () => createKyselySqliteStateProvider({ db }),
  });

  afterAll(async () => {
    await db.destroy();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
