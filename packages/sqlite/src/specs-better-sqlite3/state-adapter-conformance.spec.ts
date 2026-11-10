import Database from "better-sqlite3";
import { it as baseIt, describe } from "vitest";

import {
  type SqliteStateProviderConformanceContext,
  createSqliteStateProviderConformanceContext,
  sqliteStateProviderConformanceCases,
} from "../conformance/state-provider-conformance.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";

const it = baseIt.extend<{ conformance: SqliteStateProviderConformanceContext }>({
  conformance: [
    // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
    async ({}, use) => {
      const db = new Database(":memory:");
      await use(
        await createSqliteStateProviderConformanceContext({
          createStateProvider: async () => createBetterSqlite3Provider({ db }),
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
  for (const conformanceCase of sqliteStateProviderConformanceCases) {
    it(conformanceCase.title, async ({ conformance }) => {
      await conformanceCase.run(conformance);
    });
  }
});
