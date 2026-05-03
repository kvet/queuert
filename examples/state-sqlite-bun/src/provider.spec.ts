import { Database } from "bun:sqlite";
import { test } from "bun:test";

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import { runStateAdapterConformance } from "queuert/conformance";

import { createBunSqliteStateProvider } from "./provider.js";

test("state-sqlite-bun provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const db = new Database(":memory:");
    db.run("PRAGMA auto_vacuum = INCREMENTAL");
    db.run("PRAGMA foreign_keys = ON");

    const lock = createAsyncRwLock();
    const stateProvider = createBunSqliteStateProvider({ db, lock });
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
