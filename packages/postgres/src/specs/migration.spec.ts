import { extendWithPostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { it as baseIt, describe, expect } from "vitest";

import { migrations } from "../state-adapter/sql.js";
import { type PgStateAdapter, createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";
import { type PgPoolContext, createPgPoolProvider } from "./state-provider.pg-pool.js";

const it = extendWithPostgres(baseIt, import.meta.url).extend<{
  pool: Pool;
  stateAdapter: PgStateAdapter<PgPoolContext>;
}>({
  pool: async ({ postgresConnectionString }, use) => {
    const pool = new Pool({ connectionString: postgresConnectionString, idleTimeoutMillis: 0 });
    await pool.query(
      "DROP TABLE IF EXISTS queuert_job_blocker, queuert_job, queuert_migration CASCADE; DROP TYPE IF EXISTS queuert_job_status CASCADE",
    );
    await use(pool);
    await pool.end();
  },
  stateAdapter: async ({ pool }, use) => {
    const stateProvider = createPgPoolProvider({ pool });
    await use(await createPgStateAdapter({ stateProvider }));
  },
});

describe("PostgreSQL migrations", () => {
  it("fresh install applies all migrations", async ({ stateAdapter }) => {
    const result = await stateAdapter.migrateToLatest();

    expect(result.skipped).toEqual([]);
    expect(result.applied).toEqual(migrations.map((m) => m.name));
    expect(result.unrecognized).toEqual([]);
  });

  it("running twice is idempotent", async ({ stateAdapter }) => {
    const firstResult = await stateAdapter.migrateToLatest();
    expect(firstResult.applied.length).toBeGreaterThan(0);

    const secondResult = await stateAdapter.migrateToLatest();
    expect(secondResult.skipped).toEqual(migrations.map((m) => m.name));
    expect(secondResult.applied).toEqual([]);
    expect(secondResult.unrecognized).toEqual([]);
  });

  it("vacuum runs without error", async ({ stateAdapter }) => {
    await stateAdapter.migrateToLatest();

    await expect(stateAdapter.vacuum()).resolves.toBeUndefined();
  });

  it("returns unknown migrations when database is ahead", async ({ stateAdapter, pool }) => {
    await stateAdapter.migrateToLatest();

    await pool.query(
      "INSERT INTO queuert_migration (name) VALUES ('20991231235959_future_migration')",
    );

    const result = await stateAdapter.migrateToLatest();

    expect(result.skipped).toEqual(migrations.map((m) => m.name));
    expect(result.applied).toEqual([]);
    expect(result.unrecognized).toEqual(["20991231235959_future_migration"]);
  });
});
