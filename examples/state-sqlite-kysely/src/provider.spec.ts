import { createSqliteStateAdapter } from "@queuert/sqlite";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createKyselySqliteStateProvider } from "./provider.js";

type Database = Record<string, never>;

test("state-sqlite-kysely provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const sqliteDb = new BetterSqlite3(":memory:");
    sqliteDb.pragma("auto_vacuum = INCREMENTAL");
    sqliteDb.pragma("foreign_keys = ON");

    const db = new Kysely<Database>({
      dialect: new SqliteDialect({ database: sqliteDb }),
    });

    const stateProvider = createKyselySqliteStateProvider({ db });
    const adapter = await createSqliteStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await db.destroy();
      },
    };
  });
}, 30_000);
