import type { DatabaseSync } from "node:sqlite";

import type { Migration } from "@queuert/sqlite";

import type { NodeSqliteContext } from "./provider.ts";

// Transactional migrations run inside the provider's synchronous transaction; non-transactional
// ones run outside a transaction, one synchronous statement at a time.
export const createMigrations = ({
  db,
}: {
  db: DatabaseSync;
}): Migration<NodeSqliteContext, "sync">[] => [
  {
    name: "create_invoices",
    up: (txCtx) => {
      txCtx.db.exec(
        "CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, status TEXT)",
      );
      const insert = txCtx.db.prepare("INSERT INTO invoices (id, customer) VALUES (?, ?)");
      for (const id of [1, 2, 3, 4, 5]) insert.run(id, `customer-${id}`);
    },
    down: (txCtx) => {
      txCtx.db.exec("DROP TABLE invoices");
    },
  },
  {
    name: "invoices_customer_idx",
    up: (txCtx) => {
      txCtx.db.exec("CREATE INDEX invoices_customer_idx ON invoices (customer)");
    },
    down: (txCtx) => {
      txCtx.db.exec("DROP INDEX invoices_customer_idx");
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: ({ assertLockHeld }) => {
      const backfillBatch = db.prepare(
        "UPDATE invoices SET status = ? WHERE id IN (SELECT id FROM invoices WHERE status IS NULL LIMIT 2)",
      );
      for (;;) {
        assertLockHeld();
        if (Number(backfillBatch.run("open").changes) === 0) return;
      }
    },
    down: () => {
      db.exec("UPDATE invoices SET status = NULL");
    },
  },
  {
    name: "uppercase_customers",
    type: "non-transactional",
    up: ({ assertLockHeld }) => {
      const invoices = db.prepare("SELECT id, customer FROM invoices ORDER BY id").all() as {
        id: number;
        customer: string;
      }[];
      for (const { id, customer } of invoices) {
        assertLockHeld();
        db.prepare("UPDATE invoices SET customer = ? WHERE id = ?").run(customer.toUpperCase(), id);
      }
    },
    down: () => {
      db.exec("UPDATE invoices SET customer = lower(customer)");
    },
  },
];
