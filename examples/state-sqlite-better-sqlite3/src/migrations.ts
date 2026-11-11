import type { AsyncRwLock, Migration } from "@queuert/sqlite";
import type Database from "better-sqlite3";

import type { BetterSqlite3Context } from "./provider.ts";

// Transactional migrations run inside the provider's transaction, which already holds the write
// lock; non-transactional ones run outside a transaction and take the lock like the rest of the app.
export const createMigrations = ({
  db,
  lock,
}: {
  db: Database.Database;
  lock: AsyncRwLock;
}): Migration<BetterSqlite3Context>[] => [
  {
    name: "create_invoices",
    up: async (txCtx) => {
      txCtx.db.exec(
        "CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, status TEXT)",
      );
      const insert = txCtx.db.prepare("INSERT INTO invoices (id, customer) VALUES (?, ?)");
      for (const id of [1, 2, 3, 4, 5]) insert.run(id, `customer-${id}`);
    },
    down: async (txCtx) => {
      txCtx.db.exec("DROP TABLE invoices");
    },
  },
  {
    name: "invoices_customer_idx",
    up: async (txCtx) => {
      txCtx.db.exec("CREATE INDEX invoices_customer_idx ON invoices (customer)");
    },
    down: async (txCtx) => {
      txCtx.db.exec("DROP INDEX invoices_customer_idx");
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      const backfillBatch = db.prepare(
        "UPDATE invoices SET status = ? WHERE id IN (SELECT id FROM invoices WHERE status IS NULL LIMIT 2)",
      );
      for (;;) {
        assertLockHeld();
        using _h = await lock.acquireWrite();
        if (backfillBatch.run("open").changes === 0) return;
      }
    },
    down: async () => {
      using _h = await lock.acquireWrite();
      db.exec("UPDATE invoices SET status = NULL");
    },
  },
  {
    name: "uppercase_customers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      let invoices: { id: number; customer: string }[];
      {
        using _h = await lock.acquireRead();
        invoices = db.prepare("SELECT id, customer FROM invoices ORDER BY id").all() as {
          id: number;
          customer: string;
        }[];
      }
      for (const { id, customer } of invoices) {
        assertLockHeld();
        using _h = await lock.acquireWrite();
        db.prepare("UPDATE invoices SET customer = ? WHERE id = ?").run(customer.toUpperCase(), id);
      }
    },
    down: async () => {
      using _h = await lock.acquireWrite();
      db.exec("UPDATE invoices SET customer = lower(customer)");
    },
  },
];
