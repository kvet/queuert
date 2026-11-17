import {
  createPgMigratorConformanceContext,
  createPgStateProviderConformanceContext,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createDrizzlePgStateProvider } from "./provider.ts";

// #region conformance
describe("postgresql/state-drizzle provider conformance", () => {
  let pg: AcquiredPostgres;
  let pool: Pool;
  let db: Parameters<typeof createDrizzlePgStateProvider>[0]["db"];
  const { context, cases } = createPgStateProviderConformanceContext({
    isolationLevel: "READ COMMITTED",
    createStateProvider: async () => createDrizzlePgStateProvider({ db }),
    withNonTransactionContext: async (fn) => fn({ tx: db }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    db = drizzle(pool, { schema: {} });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("postgresql/state-drizzle migrator conformance", () => {
  let pg: AcquiredPostgres;
  let pool: Pool;
  let db: Parameters<typeof createDrizzlePgStateProvider>[0]["db"];
  const { context, cases } = createPgMigratorConformanceContext({
    createStateProvider: () => createDrizzlePgStateProvider({ db }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", `${import.meta.url}#migrator`);
    pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    db = drizzle(pool, { schema: {} });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
