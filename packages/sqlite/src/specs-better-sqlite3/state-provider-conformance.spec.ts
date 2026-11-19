// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import Database from "better-sqlite3";
import { stateAdapterAsyncGroups } from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import {
  createSqliteStateProviderConformanceContext,
  sqliteStateProviderConformanceGroups,
  sqliteSyncStateProviderConformanceGroups,
} from "../conformance/state-provider-conformance.ts";
import { withBetterSqlite3Savepoint } from "../state-provider/state-provider.better-sqlite3.spec-helper.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";

const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const db = new Database(":memory:");
  onCleanup(async () => {
    db.close();
  });
  return createSqliteStateProviderConformanceContext({
    mode: "async",
    createStateProvider: async () => createBetterSqlite3Provider({ db }),
    withNonTransactionContext: async (fn) => fn({ db }),
    withSavepoint: withBetterSqlite3Savepoint("async"),
  });
});

const syncIt = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const db = new Database(":memory:");
  onCleanup(async () => {
    db.close();
  });
  return createSqliteStateProviderConformanceContext({
    mode: "sync",
    createStateProvider: () => createBetterSqlite3Provider({ db, mode: "sync" }),
    withNonTransactionContext: (fn) => fn({ db }),
    withSavepoint: withBetterSqlite3Savepoint("sync"),
  });
});

const customOptionsIt = baseIt.extend(
  "conformance",
  { scope: "file" },
  async ({}, { onCleanup }) => {
    const db = new Database(":memory:");
    onCleanup(async () => {
      db.close();
    });
    return createSqliteStateProviderConformanceContext({
      mode: "sync",
      createStateProvider: () => createBetterSqlite3Provider({ db, mode: "sync" }),
      withNonTransactionContext: (fn) => fn({ db }),
      withSavepoint: withBetterSqlite3Savepoint("sync"),
      stateAdapterOptions: {
        tablePrefix: "custom_",
        jobIdType: "VARCHAR",
        workerIdType: "VARCHAR",
        generateJobId: () => `job.${crypto.randomUUID()}`,
        generateWorkerId: () => `worker.${crypto.randomUUID()}`,
      },
    });
  },
);

// NOTE: hack for vitest plugin
it("index");

describe("SQLite State Provider Conformance", () => {
  conformanceTestSuite({
    it,
    groups: [...sqliteStateProviderConformanceGroups, ...stateAdapterAsyncGroups],
  });
});

describe("Sync SQLite State Provider Conformance", () => {
  conformanceTestSuite({
    it: syncIt,
    groups: [...sqliteStateProviderConformanceGroups, ...sqliteSyncStateProviderConformanceGroups],
  });
});

describe("Sync SQLite State Provider Conformance - Custom Options", () => {
  conformanceTestSuite({
    it: customOptionsIt,
    groups: [...sqliteStateProviderConformanceGroups, ...sqliteSyncStateProviderConformanceGroups],
  });
});
