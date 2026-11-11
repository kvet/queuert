// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import Database from "better-sqlite3";
import { it as baseIt, describe } from "vitest";

import {
  createSqliteMigratorConformanceContext,
  sqliteMigratorConformanceGroups,
} from "../conformance/migrator-conformance.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";

const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const db = new Database(":memory:");
  onCleanup(async () => {
    db.close();
  });
  return createSqliteMigratorConformanceContext({
    stateProvider: createBetterSqlite3Provider({ db }),
  });
});

// NOTE: hack for vitest plugin
it("index");

describe("SQLite Migrator Conformance", () => {
  conformanceTestSuite({ it, groups: sqliteMigratorConformanceGroups });
});
