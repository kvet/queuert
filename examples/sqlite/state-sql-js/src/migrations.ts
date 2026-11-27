import type { AsyncRwLock, Migration } from "@queuert/sqlite";
import type { Database } from "sql.js";

import type { SqlJsContext } from "./provider.ts";

export const createMigrations = ({
  db,
  lock,
}: {
  db: Database;
  lock: AsyncRwLock;
}): Migration<SqlJsContext>[] => [
  {
    name: "create_invoices",
    up: async (txCtx) => {
      txCtx.db.run(
        "CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, status TEXT)",
      );
      for (const id of [1, 2, 3, 4, 5]) {
        txCtx.db.run("INSERT INTO invoices (id, customer) VALUES (?, ?)", [id, `customer-${id}`]);
      }
    },
    down: async (txCtx) => {
      txCtx.db.run("DROP TABLE invoices");
    },
  },
  {
    name: "invoices_customer_idx",
    up: async (txCtx) => {
      txCtx.db.run("CREATE INDEX invoices_customer_idx ON invoices (customer)");
    },
    down: async (txCtx) => {
      txCtx.db.run("DROP INDEX invoices_customer_idx");
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        using _h = await lock.acquireWrite();
        db.run(
          "UPDATE invoices SET status = ? WHERE id IN (SELECT id FROM invoices WHERE status IS NULL LIMIT 2)",
          ["open"],
        );
        if (db.getRowsModified() === 0) return;
      }
    },
    down: async () => {
      using _h = await lock.acquireWrite();
      db.run("UPDATE invoices SET status = NULL");
    },
  },
  {
    name: "uppercase_customers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      let rows: unknown[][];
      {
        using _h = await lock.acquireRead();
        rows = db.exec("SELECT id, customer FROM invoices ORDER BY id")[0]?.values ?? [];
      }
      for (const [id, customer] of rows as [number, string][]) {
        assertLockHeld();
        using _h = await lock.acquireWrite();
        db.run("UPDATE invoices SET customer = ? WHERE id = ?", [customer.toUpperCase(), id]);
      }
    },
    down: async () => {
      using _h = await lock.acquireWrite();
      db.run("UPDATE invoices SET customer = lower(customer)");
    },
  },
];
