import type { Migration } from "@queuert/sqlite";
import { type Kysely, sql } from "kysely";

import type { KyselySqliteContext } from "./provider.ts";

export type InvoicesTable = { id: number; customer: string; status: string | null };

type Database = { invoices: InvoicesTable };

// Every query of a transactional migration goes through `txCtx.db`: the outer `db` waits for the
// single connection the migration transaction holds.
export const createMigrations = ({
  db,
}: {
  db: Kysely<Database>;
}): Migration<KyselySqliteContext<Database>>[] => [
  {
    name: "create_invoices",
    up: async (txCtx) => {
      await txCtx.db.schema
        .createTable("invoices")
        .addColumn("id", "integer", (col) => col.primaryKey())
        .addColumn("customer", "text", (col) => col.notNull())
        .addColumn("status", "text")
        .execute();
      await txCtx.db
        .insertInto("invoices")
        .values([1, 2, 3, 4, 5].map((id) => ({ id, customer: `customer-${id}`, status: null })))
        .execute();
    },
    down: async (txCtx) => {
      await txCtx.db.schema.dropTable("invoices").execute();
    },
  },
  {
    name: "invoices_customer_idx",
    up: async (txCtx) => {
      await txCtx.db.schema
        .createIndex("invoices_customer_idx")
        .on("invoices")
        .column("customer")
        .execute();
    },
    down: async (txCtx) => {
      await txCtx.db.schema.dropIndex("invoices_customer_idx").execute();
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
          .where(
            "id",
            "in",
            db.selectFrom("invoices").select("id").where("status", "is", null).limit(2),
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
    name: "uppercase_customers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      const invoices = await db
        .selectFrom("invoices")
        .select(["id", "customer"])
        .orderBy("id")
        .execute();
      for (const { id, customer } of invoices) {
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
        .set({ customer: sql`lower(customer)` })
        .execute();
    },
  },
];
