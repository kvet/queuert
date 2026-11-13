import { runDeploymentProcess } from "@queuert/helpers/testing";
import { type Migration, createMigrator } from "@queuert/typed-sql/migrator";
import { Pool } from "pg";

import { createApplicationPgMigrationStore } from "../migration-store/migration-store.pg.ts";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";
import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";

export const LEASE_TTL_MS = 2_000;

export const createAppMigrations = (
  provider: PgStateProvider<PgPoolContext>,
): Migration<PgPoolContext>[] => {
  const execute = async (sql: string, txCtx?: PgPoolContext): Promise<unknown[]> =>
    provider.executeSql({
      txCtx,
      sql,
      params: [],
      paramTypes: {},
      columnTypes: {},
      readOnly: false,
    });
  return [
    {
      name: "create_invoices",
      up: async (txCtx) => {
        await execute(
          "CREATE TABLE invoices (id integer PRIMARY KEY, customer text NOT NULL, status text)",
          txCtx,
        );
        await execute(
          "CREATE TABLE invoice_events (invoice_id integer NOT NULL, kind text NOT NULL)",
          txCtx,
        );
      },
      down: async (txCtx) => {
        await execute("DROP TABLE invoice_events", txCtx);
        await execute("DROP TABLE invoices", txCtx);
      },
    },
    {
      name: "invoices_customer_idx",
      type: "non-transactional",
      up: async () => {
        await execute(
          "CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_customer_idx ON invoices (customer)",
        );
      },
      down: async () => {
        await execute("DROP INDEX CONCURRENTLY IF EXISTS invoices_customer_idx");
      },
    },
    {
      name: "seed_invoices",
      type: "non-transactional",
      up: async ({ assertLockHeld }) => {
        for (let id = 1; id <= 5; id++) {
          assertLockHeld();
          await execute(
            `INSERT INTO invoices (id, customer) VALUES (${id}, 'customer-${id}') ON CONFLICT DO NOTHING`,
          );
        }
      },
      down: async () => {
        await execute("DELETE FROM invoices");
      },
    },
    {
      name: "backfill_invoice_status",
      type: "non-transactional",
      up: async ({ assertLockHeld }) => {
        while (
          (
            await execute(
              "UPDATE invoices SET status = 'open' WHERE id IN (SELECT id FROM invoices WHERE status IS NULL LIMIT 2) RETURNING id",
            )
          ).length > 0
        ) {
          assertLockHeld();
        }
      },
      down: async () => {
        await execute("UPDATE invoices SET status = NULL");
      },
    },
  ];
};

export const NEWER: Migration<PgPoolContext> = {
  name: "create_payments",
  up: async (txCtx) => {
    await txCtx.poolClient.query("CREATE TABLE payments (id integer PRIMARY KEY)");
    await txCtx.poolClient.query(
      "INSERT INTO invoice_events (invoice_id, kind) VALUES (0, 'payments')",
    );
  },
  down: async (txCtx) => {
    await txCtx.poolClient.query("DROP TABLE payments");
  },
};

if (process.argv[1] === import.meta.filename) {
  const pool = new Pool({ connectionString: process.argv[2] });
  const provider = createPgPoolProvider({ pool });
  const store = createApplicationPgMigrationStore({ stateProvider: provider });
  await runDeploymentProcess({
    migrate: async ({ version, pause }) => {
      const recordMigration = store.recordMigration;
      store.recordMigration = async (txCtx, name) => {
        await pause("inside-migration");
        await recordMigration(txCtx, name);
      };
      const migrations = createAppMigrations(provider);
      return createMigrator({
        migrations: version === "newer" ? [...migrations, NEWER] : migrations,
        store,
        lock: { ttlMs: LEASE_TTL_MS, heartbeatIntervalMs: 200, pollIntervalMs: 50 },
        before: async () => pause("before-migrating"),
      }).migrateToLatest();
    },
    close: async () => pool.end(),
  });
}
