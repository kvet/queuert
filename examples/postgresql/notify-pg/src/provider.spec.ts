import { createPgNotifyProviderConformanceCases } from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createPgPoolNotifyProvider } from "./provider.ts";

// #region conformance
describe("postgresql/notify-pg provider conformance", () => {
  let pg: AcquiredPostgres;
  let pool: Pool;
  const cases = createPgNotifyProviderConformanceCases({
    createNotifyProvider: async () => createPgPoolNotifyProvider({ pool }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    pool = new Pool({ connectionString: pg.connectionString, max: 10 });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion
