import {
  createPgMigratorConformanceContext,
  type PgMigratorConformanceContext,
  createPgStateProviderConformanceContext,
  type PgStateProviderConformanceContext,
  pgMigratorConformanceCases,
  pgStateProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createPostgresJsStateProvider } from "./provider.ts";

// #region conformance
describe("state-postgres-postgres-js provider conformance", () => {
  let pg: AcquiredPostgres;
  let sql: postgres.Sql;
  let context: PgStateProviderConformanceContext;

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    sql = postgres(pg.connectionString, { max: 10 });
    context = await createPgStateProviderConformanceContext({
      createStateProvider: async () => createPostgresJsStateProvider({ sql }),
      withNonTransactionContext: async (fn) => fn({ txSql: sql }),
    });
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of pgStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("state-postgres-postgres-js migrator conformance", () => {
  let pg: AcquiredPostgres;
  let sql: postgres.Sql;
  let context: PgMigratorConformanceContext;

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", `${import.meta.url}#migrator`);
    sql = postgres(pg.connectionString, { max: 10 });
    context = createPgMigratorConformanceContext({
      stateProvider: createPostgresJsStateProvider({ sql }),
    });
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of pgMigratorConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
