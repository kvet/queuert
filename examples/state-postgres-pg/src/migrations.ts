import type { Migration } from "@queuert/postgres";
import type { Pool } from "pg";

import type { PgPoolContext } from "./provider.ts";

export const createMigrations = ({ db }: { db: Pool }): Migration<PgPoolContext>[] => [
  {
    name: "create_invoices",
    up: async ({ poolClient }) => {
      await poolClient.query(
        "CREATE TABLE invoices (id SERIAL PRIMARY KEY, number TEXT, customer TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT)",
      );
      await poolClient.query(
        "INSERT INTO invoices (customer, amount_cents) VALUES ($1, $2), ($3, $4)",
        ["Alice", 1200, "Bob", 3400],
      );
    },
    down: async ({ poolClient }) => {
      await poolClient.query("DROP TABLE invoices");
    },
  },
  {
    name: "invoices_customer_idx",
    type: "non-transactional",
    up: async () => {
      await db.query(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_customer_idx ON invoices (customer)",
      );
    },
    down: async () => {
      await db.query("DROP INDEX CONCURRENTLY IF EXISTS invoices_customer_idx");
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        const { rowCount } = await db.query(
          "UPDATE invoices SET status = $1 WHERE id IN (SELECT id FROM invoices WHERE status IS NULL LIMIT 1000)",
          ["open"],
        );
        if (!rowCount) return;
      }
    },
    down: async () => {
      await db.query("UPDATE invoices SET status = NULL");
    },
  },
  {
    name: "assign_invoice_numbers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      const { rows } = await db.query<{ id: number }>(
        "SELECT id FROM invoices WHERE number IS NULL ORDER BY id",
      );
      for (const { id } of rows) {
        assertLockHeld();
        await db.query("UPDATE invoices SET number = $1 WHERE id = $2", [
          `INV-${String(id).padStart(4, "0")}`,
          id,
        ]);
      }
    },
    down: async () => {
      await db.query("UPDATE invoices SET number = NULL");
    },
  },
];
