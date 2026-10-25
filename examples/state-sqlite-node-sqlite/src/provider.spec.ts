import { DatabaseSync } from "node:sqlite";

import { createSyncSqliteStateAdapter } from "@queuert/sqlite";
import { type BaseTxContext, type StateAdapter } from "queuert";
import { syncModeTestSuite } from "queuert/testing";

import { createNodeSqliteStateProvider } from "./provider.js";

syncModeTestSuite({
  createStateAdapter: async () => {
    const db = new DatabaseSync(":memory:");
    const stateAdapter = createSyncSqliteStateAdapter({
      stateProvider: createNodeSqliteStateProvider({ db }),
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
