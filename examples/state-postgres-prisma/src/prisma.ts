import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";

export const createPrisma = async ({ connectionString }: { connectionString: string }) => {
  // Push Prisma schema to database
  execSync("pnpm prisma db push --skip-generate", {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: "inherit",
  });

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: connectionString,
      },
    },
  });

  await prisma.$connect();

  return prisma;
};

export type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
