import type { Migration } from "@queuert/mysql";
import type { Pool } from "mariadb";

import type { MariadbPoolContext } from "./provider.ts";

export const createMigrations = ({ db }: { db: Pool }): Migration<MariadbPoolContext>[] => [
  {
    name: "create_invoices",
    type: "non-transactional",
    up: async () => {
      await db.query(
        "CREATE TABLE IF NOT EXISTS invoices (id INT AUTO_INCREMENT PRIMARY KEY, customer VARCHAR(255) NOT NULL, amount_cents INT NOT NULL)",
      );
    },
    down: async () => {
      await db.query("DROP TABLE IF EXISTS invoices");
    },
  },
  {
    name: "seed_invoices",
    up: async ({ connection }) => {
      await connection.query(
        "INSERT INTO invoices (customer, amount_cents) VALUES (?, ?), (?, ?)",
        ["Alice", 1200, "Bob", 3400],
      );
    },
    down: async ({ connection }) => {
      await connection.query("DELETE FROM invoices");
    },
  },
];
