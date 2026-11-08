import { runSqliteStateProviderConformance } from "@queuert/sqlite/conformance";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { test } from "vitest";

import { createKyselySqliteStateProvider } from "./provider.ts";

type Database = Record<string, never>;

// #region conformance
test("state-sqlite-kysely provider passes state provider conformance", async () => {
  await runSqliteStateProviderConformance(async () => {
    const sqliteDb = new BetterSqlite3(":memory:");

    const db = new Kysely<Database>({
      dialect: new SqliteDialect({ database: sqliteDb }),
    });

    const stateProvider = createKyselySqliteStateProvider({ db });

    return {
      stateProvider,
      withNonTransactionContext: async (fn) => fn({ db }),
      dispose: async () => {
        await db.destroy();
      },
    };
  });
}, 30_000);
// #endregion
