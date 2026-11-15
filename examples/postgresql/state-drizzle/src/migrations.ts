import type { Migration } from "@queuert/postgres";
import { asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { DrizzlePgContext } from "./provider.ts";
import { invoices } from "./schema.ts";
import type * as schema from "./schema.ts";

export const createMigrations = ({
  db,
}: {
  db: NodePgDatabase<typeof schema>;
}): Migration<DrizzlePgContext<typeof schema>>[] => [
  {
    name: "create_invoices",
    up: async ({ tx }) => {
      await tx.execute(sql`
        CREATE TABLE invoices (
          id SERIAL PRIMARY KEY,
          customer TEXT NOT NULL,
          total_cents INTEGER NOT NULL,
          status TEXT
        )
      `);
      await tx.insert(invoices).values([
        { customer: "acme", totalCents: 12_000 },
        { customer: "globex", totalCents: 4_500 },
        { customer: "initech", totalCents: 980 },
      ]);
    },
    down: async ({ tx }) => {
      await tx.execute(sql`DROP TABLE invoices`);
    },
  },
  {
    name: "create_invoices_customer_idx",
    type: "non-transactional",
    up: async () => {
      await db.execute(
        sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_customer_idx ON invoices (customer)`,
      );
    },
    down: async () => {
      await db.execute(sql`DROP INDEX CONCURRENTLY IF EXISTS invoices_customer_idx`);
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        const batch = db
          .select({ id: invoices.id })
          .from(invoices)
          .where(isNull(invoices.status))
          .limit(2);
        const { rowCount } = await db
          .update(invoices)
          .set({ status: "open" })
          .where(inArray(invoices.id, batch));
        if (!rowCount) return;
      }
    },
    down: async () => {
      await db.update(invoices).set({ status: null });
    },
  },
  {
    name: "uppercase_invoice_customers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      const rows = await db.select().from(invoices).orderBy(asc(invoices.id));
      for (const { id, customer } of rows) {
        assertLockHeld();
        await db
          .update(invoices)
          .set({ customer: customer.toUpperCase() })
          .where(eq(invoices.id, id));
      }
    },
    down: async () => {
      await db.update(invoices).set({ customer: sql`lower(${invoices.customer})` });
    },
  },
];
