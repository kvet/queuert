import {
  createPgMigratorConformanceContext,
  type PgMigratorConformanceContext,
  createPgStateProviderConformanceContext,
  type PgStateProviderConformanceContext,
  pgMigratorConformanceCases,
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

describe("state-postgres-pg migrator conformance", () => {
  let pg: AcquiredPostgres;
  let pool: Pool;
  let context: PgMigratorConformanceContext;

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    context = createPgMigratorConformanceContext({
      stateProvider: createPgPoolStateProvider({ pool }),
    });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of pgMigratorConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
