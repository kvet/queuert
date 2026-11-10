import { afterAll, beforeAll, describe, test } from "bun:test";

import {
  createPgNotifyProviderConformanceContext,
  type NotifyAdapterConformanceContext,
  pgNotifyProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import { SQL } from "bun";

import { createBunSqlNotifyProvider } from "./provider.ts";

// #region conformance
describe("notify-postgres-bun-sql provider conformance", () => {
  let pg: AcquiredPostgres;
  let sql: SQL;
  let context: NotifyAdapterConformanceContext;

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    sql = new SQL(pg.connectionString, { max: 10 });
    context = createPgNotifyProviderConformanceContext({
      createNotifyProvider: async () => createBunSqlNotifyProvider({ sql }),
    });
  }, 60_000);

  afterAll(async () => {
    await sql.close();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of pgNotifyProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
