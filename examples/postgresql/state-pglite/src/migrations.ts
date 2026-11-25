import type { PGlite } from "@electric-sql/pglite";
import type { Migration } from "@queuert/postgres";

import type { PgliteContext } from "./provider.ts";

export const createMigrations = ({ pglite }: { pglite: PGlite }): Migration<PgliteContext>[] => [
  {
    name: "create_invoices",
    up: async ({ pglite: tx }) => {
      await tx.query(
        "CREATE TABLE invoices (id SERIAL PRIMARY KEY, number TEXT, customer TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT)",
      );
      await tx.query("INSERT INTO invoices (customer, amount_cents) VALUES ($1, $2), ($3, $4)", [
        "Alice",
        1200,
        "Bob",
        3400,
      ]);
    },
    down: async ({ pglite: tx }) => {
      await tx.query("DROP TABLE invoices");
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        const { affectedRows } = await pglite.query(
          "UPDATE invoices SET status = $1 WHERE id IN (SELECT id FROM invoices WHERE status IS NULL LIMIT 1000)",
          ["open"],
        );
        if (affectedRows === 0) return;
      }
    },
    down: async () => {
      await pglite.query("UPDATE invoices SET status = NULL");
    },
  },
];
