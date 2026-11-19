import {
  createPgMigratorConformanceCases,
  createPgStateProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import knexFactory, { type Knex } from "knex";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createKnexPgStateProvider } from "./provider.ts";

// #region conformance
describe("postgresql/state-knex provider conformance", () => {
  let pg: AcquiredPostgres;
  let knex: Knex;
  const cases = createPgStateProviderConformanceCases({
    createStateProvider: async () => createKnexPgStateProvider({ knex }),
    withNonTransactionContext: async (fn) => fn({ trx: knex }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    knex = knexFactory({
      client: "pg",
      connection: {
        connectionString: pg.connectionString,
        pipeline: true,
      } as Knex.PgConnectionConfig,
      pool: { min: 0, max: 10 },
    });
  }, 60_000);

  afterAll(async () => {
    await knex.destroy();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion

describe("postgresql/state-knex migrator conformance", () => {
  let pg: AcquiredPostgres;
  let knex: Knex;
  const cases = createPgMigratorConformanceCases({
    createStateProvider: () => createKnexPgStateProvider({ knex }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", `${import.meta.url}#migrator`);
    knex = knexFactory({
      client: "pg",
      connection: {
        connectionString: pg.connectionString,
        pipeline: true,
      } as Knex.PgConnectionConfig,
      pool: { min: 0, max: 10 },
    });
  }, 60_000);

  afterAll(async () => {
    await knex.destroy();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
