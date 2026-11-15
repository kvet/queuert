import type { Migration } from "@queuert/mysql";
import { sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";

import type { DrizzleMysqlContext } from "./provider.ts";
import { invoices } from "./schema.ts";
import type * as schema from "./schema.ts";

export const createMigrations = ({
  db,
}: {
  db: MySql2Database<typeof schema>;
}): Migration<DrizzleMysqlContext<typeof schema>>[] => [
  {
    name: "create_invoices",
    type: "non-transactional",
    up: async () => {
      await db.execute(
        sql`CREATE TABLE IF NOT EXISTS invoices (id INT AUTO_INCREMENT PRIMARY KEY, customer VARCHAR(255) NOT NULL, amount_cents INT NOT NULL)`,
      );
    },
    down: async () => {
      await db.execute(sql`DROP TABLE IF EXISTS invoices`);
    },
  },
  {
    name: "seed_invoices",
    up: async ({ tx }) => {
      await tx.insert(invoices).values([
        { customer: "Alice", amountCents: 1200 },
        { customer: "Bob", amountCents: 3400 },
      ]);
    },
    down: async ({ tx }) => {
      await tx.delete(invoices);
    },
  },
];
