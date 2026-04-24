import { DatabaseSync } from "node:sqlite";

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createNodeSqliteStateProvider } from "./provider.js";

test("state-sqlite-node provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    db.exec("PRAGMA foreign_keys = ON");

    const lock = createAsyncRwLock();
    const stateProvider = createNodeSqliteStateProvider({ db, lock });
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
