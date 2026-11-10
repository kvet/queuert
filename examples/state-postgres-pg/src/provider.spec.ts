import {
  createPgStateProviderConformanceContext,
  type PgStateProviderConformanceContext,
  pgStateProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { type AcquiredPostgres, acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createPgPoolStateProvider } from "./provider.ts";

// #region conformance
describe("state-postgres-pg provider conformance", () => {
  let pg: AcquiredPostgres;
  let pool: Pool;
  let context: PgStateProviderConformanceContext;

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    context = await createPgStateProviderConformanceContext({
      createStateProvider: async () => createPgPoolStateProvider({ pool }),
      withNonTransactionContext: async (fn) => {
        const poolClient = await pool.connect();
        try {
          return await fn({ poolClient });
        } finally {
          poolClient.release();
        }
      },
    });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of pgStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
