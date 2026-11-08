import { runSqliteStateProviderConformance } from "@queuert/sqlite/conformance";
import knexFactory from "knex";
import { test } from "vitest";

import { createKnexSqliteStateProvider } from "./provider.ts";

// #region conformance
test("state-sqlite-knex provider passes state provider conformance", async () => {
  await runSqliteStateProviderConformance(async () => {
    const knex = knexFactory({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });

    const stateProvider = createKnexSqliteStateProvider({ knex });

    return {
      stateProvider,
      withNonTransactionContext: async (fn) => fn({ trx: knex }),
      dispose: async () => {
        await knex.destroy();
      },
    };
  });
}, 30_000);
// #endregion
