import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createAsyncRwLock } from "@queuert/sqlite";
import {
  createSqliteMigratorConformanceCases,
  createSqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";
import { afterAll, beforeAll, describe, test } from "vitest";

import type { PrismaClient } from "../prisma/generated/prisma/client.ts";
import { createPrismaSqliteStateProvider } from "./provider.ts";

const EXAMPLE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

// #region conformance
describe("sqlite/state-prisma provider conformance", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "queuert-sqlite-prisma-spec-"));
  let prisma: PrismaClient;
  const lock = createAsyncRwLock();
  const cases = createSqliteStateProviderConformanceCases({
    mode: "async",
    createStateProvider: async () => createPrismaSqliteStateProvider({ prisma, lock }),
    withNonTransactionContext: async (fn) => fn({ prisma }),
  });

  beforeAll(async () => {
    const dbPath = join(tempDir, "test.db");
    process.env.DATABASE_URL = `file:${dbPath}`;
    execSync("npx prisma db push", { stdio: "inherit", cwd: EXAMPLE_DIR });
    const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");
    const prismaAdapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
    prisma = new PrismaClient({ adapter: prismaAdapter });
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(tempDir, { recursive: true, force: true });
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
// #endregion

describe("sqlite/state-prisma migrator conformance", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "queuert-sqlite-prisma-migrator-spec-"));
  let prisma: PrismaClient;
  const cases = createSqliteMigratorConformanceCases({
    mode: "async",
    createStateProvider: () =>
      createPrismaSqliteStateProvider({ prisma, lock: createAsyncRwLock() }),
  });

  beforeAll(async () => {
    const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");
    const prismaAdapter = new PrismaBetterSqlite3({ url: `file:${join(tempDir, "test.db")}` });
    prisma = new PrismaClient({ adapter: prismaAdapter });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(tempDir, { recursive: true, force: true });
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run();
    });
  }
});
