import {
  createSqliteMigratorConformanceCases,
  createSqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";
import initSqlJs from "sql.js";
import { describe, test } from "vitest";

import { createSqlJsStateProvider } from "./sqlite.ts";

const SQL = await initSqlJs({ useOldExtensionFunctions: false });

describe("tutorial sql.js provider conformance", () => {
  const db = new SQL.Database();
  const cases = createSqliteStateProviderConformanceCases({
    mode: "async",
    createStateProvider: async () => createSqlJsStateProvider({ db }),
    withNonTransactionContext: async (fn) => fn({ db }),
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});

describe("tutorial sql.js migrator conformance", () => {
  const db = new SQL.Database();
  const cases = createSqliteMigratorConformanceCases({
    mode: "async",
    createStateProvider: () => createSqlJsStateProvider({ db }),
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
