import type { Migration } from "@queuert/sqlite";
import { eq, inArray, isNull, sql } from "drizzle-orm";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { DrizzleSqliteContext } from "./provider.ts";

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey(),
  customer: text("customer").notNull(),
  status: text("status"),
});

// Transactional migrations run inside the provider's synchronous transaction; non-transactional
// ones run outside a transaction, one synchronous statement at a time.
export const createMigrations = ({
  db,
}: {
  db: BetterSQLite3Database<Record<string, unknown>>;
}): Migration<DrizzleSqliteContext, "sync">[] => [
  {
    name: "create_invoices",
    up: (txCtx) => {
      const tx = drizzle(txCtx.db);
      tx.run(
        sql`CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, status TEXT)`,
      );
      tx.insert(invoices)
        .values([1, 2, 3, 4, 5].map((id) => ({ id, customer: `customer-${id}` })))
        .run();
    },
    down: (txCtx) => {
      drizzle(txCtx.db).run(sql`DROP TABLE invoices`);
    },
  },
  {
    name: "invoices_customer_idx",
    up: (txCtx) => {
      drizzle(txCtx.db).run(sql`CREATE INDEX invoices_customer_idx ON invoices (customer)`);
    },
    down: (txCtx) => {
      drizzle(txCtx.db).run(sql`DROP INDEX invoices_customer_idx`);
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        const { changes } = db
          .update(invoices)
          .set({ status: "open" })
          .where(
            inArray(
              invoices.id,
              db.select({ id: invoices.id }).from(invoices).where(isNull(invoices.status)).limit(2),
            ),
          )
          .run();
        if (changes === 0) return;
      }
    },
    down: () => {
      db.update(invoices).set({ status: null }).run();
    },
  },
  {
    name: "uppercase_customers",
    type: "non-transactional",
    up: ({ assertLockHeld }) => {
      const rows = db
        .select({ id: invoices.id, customer: invoices.customer })
        .from(invoices)
        .orderBy(invoices.id)
        .all();
      for (const { id, customer } of rows) {
        assertLockHeld();
        db.update(invoices)
          .set({ customer: customer.toUpperCase() })
          .where(eq(invoices.id, id))
          .run();
      }
    },
    down: () => {
      db.update(invoices)
        .set({ customer: sql`lower(${invoices.customer})` })
        .run();
    },
  },
];
