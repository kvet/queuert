// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import type { Mode } from "@queuert/sync-async";
import { migrationStoreBaseGroups, migrationStoreTransactionalDdlGroups } from "@queuert/typed-sql";
import Database from "better-sqlite3";
import { it as baseIt, describe } from "vitest";

import {
  createSqliteMigratorConformanceContext,
  sqliteMigratorConformanceGroups,
} from "../conformance/migrator-conformance.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";

const conformanceIt = (mode: Mode) =>
  baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
    const db = new Database(":memory:");
    onCleanup(async () => {
      db.close();
    });
    return createSqliteMigratorConformanceContext(
      mode === "sync"
        ? { mode, createStateProvider: () => createBetterSqlite3Provider({ db, mode }) }
        : { mode, createStateProvider: () => createBetterSqlite3Provider({ db, mode }) },
    );
  });

const it = conformanceIt("async");
const syncIt = conformanceIt("sync");

// NOTE: hack for vitest plugin
it("index");

describe("SQLite Migrator Conformance", () => {
  conformanceTestSuite({ it, groups: sqliteMigratorConformanceGroups });
});

describe("Sync SQLite Migrator Conformance", () => {
  conformanceTestSuite({
    it: syncIt,
    groups: [...migrationStoreBaseGroups, ...migrationStoreTransactionalDdlGroups],
  });
});
