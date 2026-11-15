import type { Migration } from "@queuert/postgres";

import type { PrismaClient } from "../prisma/generated/prisma/client.ts";
import type { PrismaPgContext } from "./provider.ts";

export const createMigrations = ({
  db,
}: {
  db: PrismaClient;
}): Migration<PrismaPgContext<PrismaClient>>[] => [
  {
    name: "create_invoices",
    up: async ({ prisma }) => {
      await prisma.$executeRaw`
        CREATE TABLE invoices (
          id SERIAL PRIMARY KEY,
          customer TEXT NOT NULL,
          total_cents INTEGER NOT NULL,
          status TEXT
        )
      `;
      await prisma.$executeRaw`
        INSERT INTO invoices (customer, total_cents)
        VALUES (${"acme"}, ${12_000}), (${"globex"}, ${4_500}), (${"initech"}, ${980})
      `;
    },
    down: async ({ prisma }) => {
      await prisma.$executeRaw`DROP TABLE invoices`;
    },
  },
  {
    name: "create_invoices_customer_idx",
    type: "non-transactional",
    up: async () => {
      await db.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_customer_idx ON invoices (customer)`;
    },
    down: async () => {
      await db.$executeRaw`DROP INDEX CONCURRENTLY IF EXISTS invoices_customer_idx`;
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        const updated = await db.$executeRaw`
          UPDATE invoices SET status = ${"open"}
          WHERE id IN (SELECT id FROM invoices WHERE status IS NULL LIMIT ${2})
        `;
        if (updated === 0) return;
      }
    },
    down: async () => {
      await db.$executeRaw`UPDATE invoices SET status = NULL`;
    },
  },
  {
    name: "uppercase_invoice_customers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      const rows = await db.$queryRaw<{ id: number; customer: string }[]>`
        SELECT id, customer FROM invoices ORDER BY id
      `;
      for (const { id, customer } of rows) {
        assertLockHeld();
        await db.$executeRaw`UPDATE invoices SET customer = ${customer.toUpperCase()} WHERE id = ${id}`;
      }
    },
    down: async () => {
      await db.$executeRaw`UPDATE invoices SET customer = lower(customer)`;
    },
  },
];
