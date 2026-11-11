import type { Migration } from "@queuert/sqlite";
import type { Knex } from "knex";

import type { KnexSqliteContext } from "./provider.ts";

export type Invoice = { id: number; customer: string; status: string | null };

// Every query of a transactional migration goes through `txCtx.trx`: the outer `db` waits for
// the single connection the migration transaction holds.
export const createMigrations = ({ db }: { db: Knex }): Migration<KnexSqliteContext>[] => [
  {
    name: "create_invoices",
    up: async ({ trx }) => {
      await trx.schema.createTable("invoices", (table) => {
        table.integer("id").primary();
        table.text("customer").notNullable();
        table.text("status");
      });
      await trx<Invoice>("invoices").insert(
        [1, 2, 3, 4, 5].map((id) => ({ id, customer: `customer-${id}` })),
      );
    },
    down: async ({ trx }) => {
      await trx.schema.dropTable("invoices");
    },
  },
  {
    name: "invoices_customer_idx",
    up: async ({ trx }) => {
      await trx.schema.alterTable("invoices", (table) => {
        table.index("customer", "invoices_customer_idx");
      });
    },
    down: async ({ trx }) => {
      await trx.schema.alterTable("invoices", (table) => {
        table.dropIndex("customer", "invoices_customer_idx");
      });
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        const updated = await db<Invoice>("invoices")
          .update({ status: "open" })
          .whereIn("id", db<Invoice>("invoices").select("id").whereNull("status").limit(2));
        if (updated === 0) return;
      }
    },
    down: async () => {
      await db<Invoice>("invoices").update({ status: null });
    },
  },
  {
    name: "uppercase_customers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      const invoices = await db<Invoice>("invoices").select("id", "customer").orderBy("id");
      for (const { id, customer } of invoices) {
        assertLockHeld();
        await db<Invoice>("invoices").update({ customer: customer.toUpperCase() }).where({ id });
      }
    },
    down: async () => {
      await db<Invoice>("invoices").update({ customer: db.raw("lower(customer)") });
    },
  },
];
