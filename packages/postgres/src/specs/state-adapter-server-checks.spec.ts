// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { it as baseIt, describe, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import { createPgPoolProvider } from "../state-provider/state-provider.pg-pool.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

const it = baseIt.extend("pool", async ({}, { onCleanup }) => {
  const pool = new Pool({ connectionString: pg.connectionString });
  onCleanup(async () => pool.end());
  return pool;
});

describe("createPgStateAdapter server checks", () => {
  it("migrateToLatest accepts the test server", async ({ pool }) => {
    const stateAdapter = createPgStateAdapter({ stateProvider: createPgPoolProvider({ pool }) });

    await expect(stateAdapter.migrateToLatest()).resolves.toBeDefined();
  });

  it("migrateToLatest rejects PostgreSQL 13.4 as below the minimum version", async ({ pool }) => {
    const stateProvider = createPgPoolProvider({ pool });
    const stateAdapter = createPgStateAdapter({
      stateProvider: {
        ...stateProvider,
        executeSql: async (options) => {
          const rows = await stateProvider.executeSql(options);
          return options.id?.startsWith("serverVersion@")
            ? rows.map((row) => ({
                ...(row as object),
                version_num: 130004,
                version: "13.4 (Debian 13.4-1.pgdg110+1)",
              }))
            : rows;
        },
      },
      tablePrefix: "server_checks_",
    });

    await expect(stateAdapter.migrateToLatest()).rejects.toThrow(
      "Unsupported PostgreSQL version 13.4: Queuert needs 14 or later",
    );
    const { rows } = await pool.query<{ migration_table: string | null }>(
      "SELECT to_regclass('public.server_checks_migration')::text AS migration_table",
    );
    expect(rows).toEqual([{ migration_table: null }]);
  });
});
