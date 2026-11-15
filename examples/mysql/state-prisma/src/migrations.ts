import type { Migration } from "@queuert/mysql";

import type { PrismaClient } from "../prisma/generated/prisma/client.ts";
import type { PrismaMysqlContext } from "./provider.ts";

export const createMigrations = ({
  db,
}: {
  db: PrismaClient;
}): Migration<PrismaMysqlContext<PrismaClient>>[] => [
  {
    name: "create_invoices",
    type: "non-transactional",
    up: async () => {
      await db.$executeRaw`
        CREATE TABLE IF NOT EXISTS invoices (
          id INT AUTO_INCREMENT PRIMARY KEY,
          customer VARCHAR(255) NOT NULL,
          amount_cents INT NOT NULL
        )
      `;
    },
    down: async () => {
      await db.$executeRaw`DROP TABLE IF EXISTS invoices`;
    },
  },
  {
    name: "seed_invoices",
    up: async ({ prisma }) => {
      await prisma.$executeRaw`
        INSERT INTO invoices (customer, amount_cents)
        VALUES (${"Alice"}, ${1200}), (${"Bob"}, ${3400})
      `;
    },
    down: async ({ prisma }) => {
      await prisma.$executeRaw`DELETE FROM invoices`;
    },
  },
];
