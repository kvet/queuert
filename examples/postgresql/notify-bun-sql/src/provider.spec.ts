import { afterAll, beforeAll, describe, test } from "bun:test";

import { createPgNotifyProviderConformanceCases } from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import { SQL } from "bun";

import { createBunSqlNotifyProvider } from "./provider.ts";

// #region conformance
describe("postgresql/notify-bun-sql provider conformance", () => {
  let pg: AcquiredPostgres;
  let sql: SQL;
  const cases = createPgNotifyProviderConformanceCases({
    createNotifyProvider: async () => createBunSqlNotifyProvider({ sql }),
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
      await conformanceCase.run();
    });
  }
});
// #endregion
