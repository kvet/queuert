import {
  createPgMigratorConformanceCases,
  createPgStateProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { type AcquiredPostgres, acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createPgPoolStateProvider } from "./provider.ts";

// #region conformance
describe("postgresql/state-pg provider conformance", () => {
  let pg: AcquiredPostgres;
  let pool: Pool;
  const cases = createPgStateProviderConformanceCases({
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

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    pool = new Pool({
      connectionString: pg.connectionString,
      idleTimeoutMillis: 0,
      pipeline: true,
    });
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

describe("postgresql/state-pg migrator conformance", () => {
  let pg: AcquiredPostgres;
  let pool: Pool;
  const cases = createPgMigratorConformanceCases({
    createStateProvider: () => createPgPoolStateProvider({ pool }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", `${import.meta.url}#migrator`);
    pool = new Pool({
      connectionString: pg.connectionString,
      idleTimeoutMillis: 0,
      pipeline: true,
    });
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
