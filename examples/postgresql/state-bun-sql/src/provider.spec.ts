import { afterAll, beforeAll, describe, test } from "bun:test";

import {
  createPgMigratorConformanceContext,
  createPgStateProviderConformanceContext,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import { SQL } from "bun";

import { createBunSqlStateProvider } from "./provider.ts";

// #region conformance
describe("postgresql/state-bun-sql provider conformance", () => {
  let pg: AcquiredPostgres;
  let sql: SQL;
  const { context, cases } = createPgStateProviderConformanceContext({
    isolationLevel: "READ COMMITTED",
    createStateProvider: async () => createBunSqlStateProvider({ sql }),
    withNonTransactionContext: async (fn) => fn({ txSql: sql }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    sql = new SQL(pg.connectionString, { max: 10 });
  }, 60_000);

  afterAll(async () => {
    await sql.close();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("postgresql/state-bun-sql migrator conformance", () => {
  let pg: AcquiredPostgres;
  let sql: SQL;
  const { context, cases } = createPgMigratorConformanceContext({
    createStateProvider: () => createBunSqlStateProvider({ sql }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", `${import.meta.url}#migrator`);
    sql = new SQL(pg.connectionString, { max: 10 });
  }, 60_000);

  afterAll(async () => {
    await sql.close();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
