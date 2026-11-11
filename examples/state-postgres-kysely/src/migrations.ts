import type { Migration } from "@queuert/postgres";
import { type Kysely, sql } from "kysely";

import type { Database } from "./database.ts";
import type { KyselyPgContext } from "./provider.ts";

export const createMigrations = ({
  db,
}: {
  db: Kysely<Database>;
}): Migration<KyselyPgContext<Database>>[] => [
  {
    name: "create_invoices",
    up: async ({ db }) => {
      await db.schema
        .createTable("invoices")
        .addColumn("id", "serial", (col) => col.primaryKey())
        .addColumn("customer", "text", (col) => col.notNull())
        .addColumn("total_cents", "integer", (col) => col.notNull())
        .addColumn("status", "text")
        .execute();
      await db
        .insertInto("invoices")
        .values([
          { customer: "acme", total_cents: 12_000 },
          { customer: "globex", total_cents: 4_500 },
          { customer: "initech", total_cents: 980 },
        ])
        .execute();
    },
    down: async ({ db }) => {
      await db.schema.dropTable("invoices").execute();
    },
  },
  {
    name: "create_invoices_customer_idx",
    type: "non-transactional",
    up: async () => {
      await sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_customer_idx ON invoices (customer)`.execute(
        db,
      );
    },
    down: async () => {
      await sql`DROP INDEX CONCURRENTLY IF EXISTS invoices_customer_idx`.execute(db);
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        const { numUpdatedRows } = await db
          .updateTable("invoices")
          .set({ status: "open" })
          .where("id", "in", (eb) =>
            eb.selectFrom("invoices").select("id").where("status", "is", null).limit(2),
          )
          .executeTakeFirstOrThrow();
        if (numUpdatedRows === 0n) return;
      }
    },
    down: async () => {
      await db.updateTable("invoices").set({ status: null }).execute();
    },
  },
  {
    name: "uppercase_invoice_customers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      const rows = await db
        .selectFrom("invoices")
        .select(["id", "customer"])
        .orderBy("id")
        .execute();
      for (const { id, customer } of rows) {
        assertLockHeld();
        await db
          .updateTable("invoices")
          .set({ customer: customer.toUpperCase() })
          .where("id", "=", id)
          .execute();
      }
    },
    down: async () => {
      await db
        .updateTable("invoices")
        .set({ customer: sql<string>`lower(customer)` })
        .execute();
    },
  },
];
