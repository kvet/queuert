import type { AsyncRwLock, Migration } from "@queuert/sqlite";
import type { SQL } from "bun";

import type { BunSqlSqliteContext } from "./provider.ts";

// Transactional migrations run inside the provider's transaction, which already holds the write
// lock; non-transactional ones run outside a transaction and take the lock like the rest of the app.
export const createMigrations = ({
  sql,
  lock,
}: {
  sql: SQL;
  lock: AsyncRwLock;
}): Migration<BunSqlSqliteContext>[] => [
  {
    name: "create_invoices",
    up: async ({ txSql }) => {
      await txSql`CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, status TEXT)`;
      for (const id of [1, 2, 3, 4, 5]) {
        await txSql`INSERT INTO invoices (id, customer) VALUES (${id}, ${`customer-${id}`})`;
      }
    },
    down: async ({ txSql }) => {
      await txSql`DROP TABLE invoices`;
    },
  },
  {
    name: "invoices_customer_idx",
    up: async ({ txSql }) => {
      await txSql`CREATE INDEX invoices_customer_idx ON invoices (customer)`;
    },
    down: async ({ txSql }) => {
      await txSql`DROP INDEX invoices_customer_idx`;
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        using _h = await lock.acquireWrite();
        const { count } = await sql`
          UPDATE invoices SET status = ${"open"}
          WHERE id IN (SELECT id FROM invoices WHERE status IS NULL LIMIT 2)
        `;
        if (count === 0) return;
      }
    },
    down: async () => {
      using _h = await lock.acquireWrite();
      await sql`UPDATE invoices SET status = NULL`;
    },
  },
  {
    name: "uppercase_customers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      let invoices: { id: number; customer: string }[];
      {
        using _h = await lock.acquireRead();
        invoices = await sql`SELECT id, customer FROM invoices ORDER BY id`;
      }
      for (const { id, customer } of invoices) {
        assertLockHeld();
        using _h = await lock.acquireWrite();
        await sql`UPDATE invoices SET customer = ${customer.toUpperCase()} WHERE id = ${id}`;
      }
    },
    down: async () => {
      using _h = await lock.acquireWrite();
      await sql`UPDATE invoices SET customer = lower(customer)`;
    },
  },
];
