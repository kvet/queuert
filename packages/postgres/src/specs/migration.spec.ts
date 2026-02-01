import { extendWithPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { it as baseIt, describe, expect } from "vitest";
import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import { migrations } from "../state-adapter/sql.js";
import { createPgPoolProvider } from "./state-provider.pg-pool.js";

const it = extendWithPostgres(baseIt, import.meta.url);

const withFreshSchema = async <T>(
  postgresConnectionString: string,
  fn: (pool: Pool) => Promise<T>,
): Promise<T> => {
  const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
  try {
    await pool.query("DROP SCHEMA IF EXISTS queuert CASCADE");
    await pool.query("CREATE SCHEMA queuert");
    return await fn(pool);
  } finally {
    await pool.end();
  }
};

describe("PostgreSQL migrations", () => {
  it("fresh install applies all migrations", async ({ postgresConnectionString }) => {
    await withFreshSchema(postgresConnectionString, async (pool) => {
      const stateProvider = createPgPoolProvider({ pool });
      const stateAdapter = await createPgStateAdapter({ stateProvider });

      const result = await stateAdapter.migrateToLatest();

      expect(result.skipped).toEqual([]);
      expect(result.applied).toEqual(migrations.map((m) => m.name));
      expect(result.unrecognized).toEqual([]);
    });
  });

  it("running twice is idempotent", async ({ postgresConnectionString }) => {
    await withFreshSchema(postgresConnectionString, async (pool) => {
      const stateProvider = createPgPoolProvider({ pool });
      const stateAdapter = await createPgStateAdapter({ stateProvider });

      const firstResult = await stateAdapter.migrateToLatest();
      expect(firstResult.applied.length).toBeGreaterThan(0);

      const secondResult = await stateAdapter.migrateToLatest();
      expect(secondResult.skipped).toEqual(migrations.map((m) => m.name));
      expect(secondResult.applied).toEqual([]);
      expect(secondResult.unrecognized).toEqual([]);
    });
  });

  it("returns unknown migrations when database is ahead", async ({ postgresConnectionString }) => {
    await withFreshSchema(postgresConnectionString, async (pool) => {
      const stateProvider = createPgPoolProvider({ pool });
      const stateAdapter = await createPgStateAdapter({ stateProvider });

      await stateAdapter.migrateToLatest();

      await pool.query(
        "INSERT INTO queuert.queuert_migration (name) VALUES ('20991231235959_future_migration')",
      );

      const result = await stateAdapter.migrateToLatest();

      expect(result.skipped).toEqual(migrations.map((m) => m.name));
      expect(result.applied).toEqual([]);
      expect(result.unrecognized).toEqual(["20991231235959_future_migration"]);
    });
  });
});
