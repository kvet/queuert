import type { Migration } from "@queuert/postgres";
import type { Knex } from "knex";

import type { KnexPgContext } from "./provider.ts";

export type Invoice = {
  id: number;
  customer: string;
  total_cents: number;
  status: string | null;
};

export const createMigrations = ({ db }: { db: Knex }): Migration<KnexPgContext>[] => [
  {
    name: "create_invoices",
    up: async ({ trx }) => {
      await trx.schema.createTable("invoices", (table) => {
        table.increments("id");
        table.text("customer").notNullable();
        table.integer("total_cents").notNullable();
        table.text("status");
      });
      await trx<Invoice>("invoices").insert([
        { customer: "acme", total_cents: 12_000 },
        { customer: "globex", total_cents: 4_500 },
        { customer: "initech", total_cents: 980 },
      ]);
    },
    down: async ({ trx }) => {
      await trx.schema.dropTable("invoices");
    },
  },
  {
    name: "create_invoices_customer_idx",
    type: "non-transactional",
    up: async () => {
      await db.raw(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_customer_idx ON invoices (customer)",
      );
    },
    down: async () => {
      await db.raw("DROP INDEX CONCURRENTLY IF EXISTS invoices_customer_idx");
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        const updated = await db<Invoice>("invoices")
          .whereIn("id", db<Invoice>("invoices").select("id").whereNull("status").limit(2))
          .update({ status: "open" });
        if (updated === 0) return;
      }
    },
    down: async () => {
      await db<Invoice>("invoices").update({ status: null });
    },
  },
  {
    name: "uppercase_invoice_customers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      const rows = await db<Invoice>("invoices").select("id", "customer").orderBy("id");
      for (const { id, customer } of rows) {
        assertLockHeld();
        await db<Invoice>("invoices").where({ id }).update({ customer: customer.toUpperCase() });
      }
    },
    down: async () => {
      await db<Invoice>("invoices").update({ customer: db.raw("lower(customer)") });
    },
  },
];
