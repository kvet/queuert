import { createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { runStateAdapterConformance } from "queuert/conformance";
import { createAsyncLock } from "queuert/internal";
import { test } from "vitest";

import { createBetterSqlite3StateProvider } from "./provider.js";

test("state-sqlite-better-sqlite3 provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const db = new Database(":memory:");
    db.pragma("auto_vacuum = INCREMENTAL");
    db.pragma("foreign_keys = ON");

    const lock = createAsyncLock();
    const stateProvider = createBetterSqlite3StateProvider({ db, lock });
    const adapter = await createSqliteStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      reset: async () => adapter.truncate(),
      dispose: async () => {
        db.close();
      },
    };
  });
}, 30_000);
