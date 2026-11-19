import { createPgNotifyProviderConformanceCases } from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createPostgresJsNotifyProvider } from "./provider.ts";

// #region conformance
describe("postgresql/notify-postgres-js provider conformance", () => {
  let pg: AcquiredPostgres;
  let sql: postgres.Sql;
  const cases = createPgNotifyProviderConformanceCases({
    createNotifyProvider: async () => createPostgresJsNotifyProvider({ sql }),
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
      await conformanceCase.run();
    });
  }
});
// #endregion
