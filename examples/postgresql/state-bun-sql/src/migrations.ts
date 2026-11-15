import type { Migration } from "@queuert/postgres";
import type { SQL } from "bun";

import type { BunSqlContext } from "./provider.ts";

export const createMigrations = ({ sql }: { sql: SQL }): Migration<BunSqlContext>[] => [
  {
    name: "create_invoices",
    up: async ({ txSql }) => {
      await txSql`
        CREATE TABLE invoices (id SERIAL PRIMARY KEY, number TEXT, customer TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT)
      `;
      await txSql`
        INSERT INTO invoices (customer, amount_cents) VALUES (${"Alice"}, ${1200}), (${"Bob"}, ${3400})
      `;
    },
    down: async ({ txSql }) => {
      await txSql`DROP TABLE invoices`;
    },
  },
  {
    name: "invoices_customer_idx",
    type: "non-transactional",
    up: async () => {
      await sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_customer_idx ON invoices (customer)`;
    },
    down: async () => {
      await sql`DROP INDEX CONCURRENTLY IF EXISTS invoices_customer_idx`;
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        const { count } = await sql`
          UPDATE invoices SET status = ${"open"}
          WHERE id IN (SELECT id FROM invoices WHERE status IS NULL LIMIT 1000)
        `;
        if (count === 0) return;
      }
    },
    down: async () => {
      await sql`UPDATE invoices SET status = NULL`;
    },
  },
  {
    name: "assign_invoice_numbers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      const rows: { id: number }[] = await sql`
        SELECT id FROM invoices WHERE number IS NULL ORDER BY id
      `;
      for (const { id } of rows) {
        assertLockHeld();
        await sql`UPDATE invoices SET number = ${`INV-${String(id).padStart(4, "0")}`} WHERE id = ${id}`;
      }
    },
    down: async () => {
      await sql`UPDATE invoices SET number = NULL`;
    },
  },
];
