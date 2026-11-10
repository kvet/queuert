import Database from "better-sqlite3";
import { type ConformanceFixtures, conformanceTestSuite } from "queuert/testing";
import { it as baseIt, describe } from "vitest";

import {
  type SqliteStateProviderConformanceContext,
  createSqliteConformanceContext,
  sqliteStateProviderConformanceGroups,
} from "../conformance/state-provider-conformance.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";

const it = baseIt.extend<ConformanceFixtures<SqliteStateProviderConformanceContext>>({
  conformance: [
    // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
    async ({}, use) => {
      const db = new Database(":memory:");
      await use(
        await createSqliteConformanceContext({
          stateProvider: createBetterSqlite3Provider({ db }),
          withNonTransactionContext: async (fn) => fn({ db }),
        }),
      );
      db.close();
    },
    { scope: "file" },
  ],
});

// NOTE: hack for vitest plugin
it("index");

describe("SQLite State Provider Conformance", () => {
  conformanceTestSuite({ it, groups: sqliteStateProviderConformanceGroups });
});
