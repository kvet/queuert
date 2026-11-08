import { runPgStateProviderConformance } from "@queuert/postgres/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import knexFactory from "knex";
import { test } from "vitest";

import { createKnexPgStateProvider } from "./provider.ts";

// #region conformance
test("state-postgres-knex provider passes state provider conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runPgStateProviderConformance(async () => {
    const knex = knexFactory({
      client: "pg",
      connection: pg.connectionString,
      pool: { min: 0, max: 10 },
    });

    const stateProvider = createKnexPgStateProvider({ knex });

    return {
      stateProvider,
      withNonTransactionContext: async (fn) => fn({ trx: knex }),
      dispose: async () => {
        await knex.destroy();
      },
    };
  });
}, 60_000);
// #endregion
