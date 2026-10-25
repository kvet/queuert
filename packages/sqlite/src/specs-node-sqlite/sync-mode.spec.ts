import { DatabaseSync } from "node:sqlite";

import { type BaseTxContext, type StateAdapter } from "queuert";
import { syncModeTestSuite } from "queuert/testing";

import { createSyncSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { createNodeSqliteSyncProvider } from "../state-provider/state-provider.node-sqlite.js";

syncModeTestSuite({
  createStateAdapter: async () => {
    const db = new DatabaseSync(":memory:");
    const stateAdapter = createSyncSqliteStateAdapter({
      stateProvider: createNodeSqliteSyncProvider({ db }),
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
