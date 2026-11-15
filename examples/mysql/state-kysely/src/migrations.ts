import type { Migration } from "@queuert/mysql";
import type { Kysely } from "kysely";

import type { Database } from "./database.ts";
import type { KyselyMysqlContext } from "./provider.ts";

export const createMigrations = ({
  db,
}: {
  db: Kysely<Database>;
}): Migration<KyselyMysqlContext<Database>>[] => [
  {
    name: "create_invoices",
    type: "non-transactional",
    up: async () => {
      await db.schema
        .createTable("invoices")
        .ifNotExists()
        .addColumn("id", "integer", (col) => col.autoIncrement().primaryKey())
        .addColumn("customer", "varchar(255)", (col) => col.notNull())
        .addColumn("amount_cents", "integer", (col) => col.notNull())
        .execute();
    },
    down: async () => {
      await db.schema.dropTable("invoices").ifExists().execute();
    },
  },
  {
    name: "seed_invoices",
    up: async ({ db }) => {
      await db
        .insertInto("invoices")
        .values([
          { customer: "Alice", amount_cents: 1200 },
          { customer: "Bob", amount_cents: 3400 },
        ])
        .execute();
    },
    down: async ({ db }) => {
      await db.deleteFrom("invoices").execute();
    },
  },
];
