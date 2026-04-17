import { createAsyncLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createDrizzleSqliteStateProvider } from "./provider.js";

test("state-sqlite-drizzle provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const db = new Database(":memory:");
    db.pragma("auto_vacuum = INCREMENTAL");
    db.pragma("foreign_keys = ON");

    const lock = createAsyncLock();
    const stateProvider = createDrizzleSqliteStateProvider({ db, lock });
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
