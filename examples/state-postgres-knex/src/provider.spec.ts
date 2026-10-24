import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import knexFactory from "knex";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createKnexPgStateProvider } from "./provider.js";

test("state-postgres-knex provider passes state adapter conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runStateAdapterConformance(async () => {
    const knex = knexFactory({
      client: "pg",
      connection: pg.connectionString,
      pool: { min: 0, max: 10 },
    });

    const stateProvider = createKnexPgStateProvider({ knex });
    const adapter = await createPgStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      transactionConcurrency: "concurrent",
      withNonTransactionContext: async (fn) => fn({ trx: knex }),
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await knex.destroy();
      },
    };
  });
}, 60_000);
