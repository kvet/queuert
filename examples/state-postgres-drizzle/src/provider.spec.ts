import {
  createPgMigratorConformanceContext,
  type PgMigratorConformanceContext,
  createPgStateProviderConformanceContext,
  type PgStateProviderConformanceContext,
  pgMigratorConformanceCases,
  pgStateProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createDrizzlePgStateProvider } from "./provider.ts";

// #region conformance
describe("state-postgres-drizzle provider conformance", () => {
  let pg: AcquiredPostgres;
  let pool: Pool;
  let context: PgStateProviderConformanceContext;

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    const db = drizzle(pool, { schema: {} });
    context = await createPgStateProviderConformanceContext({
      createStateProvider: async () => createDrizzlePgStateProvider({ db }),
      withNonTransactionContext: async (fn) => fn({ tx: db }),
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

describe("state-postgres-drizzle migrator conformance", () => {
  let pg: AcquiredPostgres;
  let pool: Pool;
  let context: PgMigratorConformanceContext;

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", `${import.meta.url}#migrator`);
    pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    const db = drizzle(pool, { schema: {} });
    context = createPgMigratorConformanceContext({
      stateProvider: createDrizzlePgStateProvider({ db }),
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
