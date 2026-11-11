// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import Database from "better-sqlite3";
import { it as baseIt, describe } from "vitest";

import {
  createSqliteStateProviderConformanceContext,
  sqliteStateProviderConformanceGroups,
} from "../conformance/state-provider-conformance.ts";
import { withBetterSqlite3Savepoint } from "../state-provider/state-provider.better-sqlite3.spec-helper.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";

const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const db = new Database(":memory:");
  onCleanup(async () => {
    db.close();
  });
  return createSqliteStateProviderConformanceContext({
    createStateProvider: async () => createBetterSqlite3Provider({ db }),
    withNonTransactionContext: async (fn) => fn({ db }),
    withSavepoint: withBetterSqlite3Savepoint,
  });
});

// NOTE: hack for vitest plugin
it("index");

describe("SQLite State Provider Conformance", () => {
  conformanceTestSuite({ it, groups: sqliteStateProviderConformanceGroups });
});
