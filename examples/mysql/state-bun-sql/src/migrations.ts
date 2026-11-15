import type { Migration } from "@queuert/mysql";
import type { SQL } from "bun";

import type { BunSqlContext } from "./provider.ts";

export const createMigrations = ({ sql }: { sql: SQL }): Migration<BunSqlContext>[] => [
  {
    name: "create_invoices",
    type: "non-transactional",
    up: async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS invoices (id INT AUTO_INCREMENT PRIMARY KEY, customer VARCHAR(255) NOT NULL, amount_cents INT NOT NULL)
      `;
    },
    down: async () => {
      await sql`DROP TABLE IF EXISTS invoices`;
    },
  },
  {
    name: "seed_invoices",
    up: async ({ txSql }) => {
      await txSql`
        INSERT INTO invoices (customer, amount_cents) VALUES (${"Alice"}, ${1200}), (${"Bob"}, ${3400})
      `;
    },
    down: async ({ txSql }) => {
      await txSql`DELETE FROM invoices`;
    },
  },
];
