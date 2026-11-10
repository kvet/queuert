import {
  createPgStateProviderConformanceContext,
  type PgStateProviderConformanceContext,
  pgStateProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import knexFactory, { type Knex } from "knex";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createKnexPgStateProvider } from "./provider.ts";

// #region conformance
describe("state-postgres-knex provider conformance", () => {
  let pg: AcquiredPostgres;
  let knex: Knex;
  let context: PgStateProviderConformanceContext;

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    knex = knexFactory({
      client: "pg",
      connection: pg.connectionString,
      pool: { min: 0, max: 10 },
    });
    context = await createPgStateProviderConformanceContext({
      createStateProvider: async () => createKnexPgStateProvider({ knex }),
      withNonTransactionContext: async (fn) => fn({ trx: knex }),
    });
  }, 60_000);

  afterAll(async () => {
    await knex.destroy();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of pgStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
