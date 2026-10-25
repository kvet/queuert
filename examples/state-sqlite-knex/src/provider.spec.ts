import { createAsyncSqliteStateAdapter } from "@queuert/sqlite";
import knexFactory from "knex";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createKnexSqliteStateProvider } from "./provider.js";

test("state-sqlite-knex provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const knex = knexFactory({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });

    const stateProvider = createKnexSqliteStateProvider({ knex });
    const adapter = createAsyncSqliteStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      transactionConcurrency: "serialized",
      withNonTransactionContext: async (fn) => fn({ trx: knex }),
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await knex.destroy();
      },
    };
  });
}, 30_000);
