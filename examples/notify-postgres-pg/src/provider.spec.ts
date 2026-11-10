import {
  createPgNotifyProviderConformanceContext,
  type NotifyAdapterConformanceContext,
  pgNotifyProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createPgPoolNotifyProvider } from "./provider.ts";

// #region conformance
describe("notify-postgres-pg provider conformance", () => {
  let pg: AcquiredPostgres;
  let pool: Pool;
  let context: NotifyAdapterConformanceContext;

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    pool = new Pool({ connectionString: pg.connectionString, max: 10 });
    context = createPgNotifyProviderConformanceContext({
      createNotifyProvider: async () => createPgPoolNotifyProvider({ pool }),
    });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of pgNotifyProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
