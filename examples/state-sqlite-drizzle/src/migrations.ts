import type { AsyncRwLock, Migration } from "@queuert/sqlite";
import { eq, inArray, isNull, sql } from "drizzle-orm";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { DrizzleSqliteContext } from "./provider.ts";

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey(),
  customer: text("customer").notNull(),
  status: text("status"),
});

// Transactional migrations run inside the provider's transaction, which already holds the write
// lock; non-transactional ones run outside a transaction and take the lock like the rest of the app.
export const createMigrations = ({
  db,
  lock,
}: {
  db: BetterSQLite3Database<Record<string, unknown>>;
  lock: AsyncRwLock;
}): Migration<DrizzleSqliteContext>[] => [
  {
    name: "create_invoices",
    up: async (txCtx) => {
      const tx = drizzle(txCtx.db);
      tx.run(
        sql`CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, status TEXT)`,
      );
      tx.insert(invoices)
        .values([1, 2, 3, 4, 5].map((id) => ({ id, customer: `customer-${id}` })))
        .run();
    },
    down: async (txCtx) => {
      drizzle(txCtx.db).run(sql`DROP TABLE invoices`);
    },
  },
  {
    name: "invoices_customer_idx",
    up: async (txCtx) => {
      drizzle(txCtx.db).run(sql`CREATE INDEX invoices_customer_idx ON invoices (customer)`);
    },
    down: async (txCtx) => {
      drizzle(txCtx.db).run(sql`DROP INDEX invoices_customer_idx`);
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        using _h = await lock.acquireWrite();
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
    down: async () => {
      using _h = await lock.acquireWrite();
      db.update(invoices).set({ status: null }).run();
    },
  },
  {
    name: "uppercase_customers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      let rows: { id: number; customer: string }[];
      {
        using _h = await lock.acquireRead();
        rows = db
          .select({ id: invoices.id, customer: invoices.customer })
          .from(invoices)
          .orderBy(invoices.id)
          .all();
      }
      for (const { id, customer } of rows) {
        assertLockHeld();
        using _h = await lock.acquireWrite();
        db.update(invoices)
          .set({ customer: customer.toUpperCase() })
          .where(eq(invoices.id, id))
          .run();
      }
    },
    down: async () => {
      using _h = await lock.acquireWrite();
      db.update(invoices)
        .set({ customer: sql`lower(${invoices.customer})` })
        .run();
    },
  },
];
