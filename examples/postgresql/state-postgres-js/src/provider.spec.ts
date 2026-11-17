import {
  createPgMigratorConformanceContext,
  createPgStateProviderConformanceContext,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createPostgresJsStateProvider } from "./provider.ts";

// #region conformance
describe("postgresql/state-postgres-js provider conformance", () => {
  let pg: AcquiredPostgres;
  let sql: postgres.Sql;
  const { context, cases } = createPgStateProviderConformanceContext({
    isolationLevel: "READ COMMITTED",
    createStateProvider: async () => createPostgresJsStateProvider({ sql }),
    withNonTransactionContext: async (fn) => fn({ txSql: sql }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    sql = postgres(pg.connectionString, { max: 10 });
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("postgresql/state-postgres-js migrator conformance", () => {
  let pg: AcquiredPostgres;
  let sql: postgres.Sql;
  const { context, cases } = createPgMigratorConformanceContext({
    createStateProvider: () => createPostgresJsStateProvider({ sql }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", `${import.meta.url}#migrator`);
    sql = postgres(pg.connectionString, { max: 10 });
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
