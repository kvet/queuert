import type { Migration } from "@queuert/mysql";
import type { Knex } from "knex";

import type { KnexMysqlContext } from "./provider.ts";

export type Invoice = { id: number; customer: string; amount_cents: number };

export const createMigrations = ({ db }: { db: Knex }): Migration<KnexMysqlContext>[] => [
  {
    name: "create_invoices",
    type: "non-transactional",
    up: async () => {
      await db.schema.createTable("invoices", (table) => {
        table.increments("id");
        table.string("customer").notNullable();
        table.integer("amount_cents").notNullable();
      });
    },
    down: async () => {
      await db.schema.dropTableIfExists("invoices");
    },
  },
  {
    name: "seed_invoices",
    up: async ({ trx }) => {
      await trx<Invoice>("invoices").insert([
        { customer: "Alice", amount_cents: 1200 },
        { customer: "Bob", amount_cents: 3400 },
      ]);
    },
    down: async ({ trx }) => {
      await trx<Invoice>("invoices").delete();
    },
  },
];
