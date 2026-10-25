import { createSyncSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { type BaseTxContext, type StateAdapter } from "queuert";
import { syncModeTestSuite } from "queuert/testing";

import { createBetterSqlite3StateProvider } from "./provider.js";

syncModeTestSuite({
  createStateAdapter: async () => {
    const db = new Database(":memory:");
    const stateAdapter = createSyncSqliteStateAdapter({
      stateProvider: createBetterSqlite3StateProvider({ db }),
    });
    stateAdapter.migrateToLatest();
    return {
      stateAdapter: stateAdapter as unknown as StateAdapter<BaseTxContext, string, "sync">,
      dispose: async () => {
        db.close();
      },
    };
  },
});
