import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
import { syncModeTestSuite } from "../suites/sync-mode.test-suite.js";

syncModeTestSuite({
  createStateAdapter: async () => ({
    stateAdapter: createInProcessStateAdapter({ mode: "sync" }),
    dispose: async () => {},
  }),
});
