import {
  createPgNotifyProviderConformanceContext,
  type NotifyAdapterConformanceContext,
  pgNotifyProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createPostgresJsNotifyProvider } from "./provider.ts";

// #region conformance
describe("notify-postgres-postgres-js provider conformance", () => {
  let pg: AcquiredPostgres;
  let sql: postgres.Sql;
  let context: NotifyAdapterConformanceContext;

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    sql = postgres(pg.connectionString, { max: 10 });
    context = createPgNotifyProviderConformanceContext({
      createNotifyProvider: async () => createPostgresJsNotifyProvider({ sql }),
    });
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of pgNotifyProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
