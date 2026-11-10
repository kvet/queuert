import { afterAll, beforeAll, describe, test } from "bun:test";

import {
  createPgStateProviderConformanceContext,
  type PgStateProviderConformanceContext,
  pgStateProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import { SQL } from "bun";

import { createBunSqlStateProvider } from "./provider.ts";

// #region conformance
describe("state-postgres-bun-sql provider conformance", () => {
  let pg: AcquiredPostgres;
  let sql: SQL;
  let context: PgStateProviderConformanceContext;

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    sql = new SQL(pg.connectionString, { max: 10 });
    context = await createPgStateProviderConformanceContext({
      createStateProvider: async () => createBunSqlStateProvider({ sql }),
      withNonTransactionContext: async (fn) => fn({ txSql: sql }),
    });
  }, 60_000);

  afterAll(async () => {
    await sql.close();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of pgStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
