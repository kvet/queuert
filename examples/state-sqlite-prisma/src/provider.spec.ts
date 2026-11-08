import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createAsyncRwLock } from "@queuert/sqlite";
import { runSqliteStateProviderConformance } from "@queuert/sqlite/conformance";
import { test } from "vitest";

import { createPrismaSqliteStateProvider } from "./provider.ts";

const EXAMPLE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

// #region conformance
test("state-sqlite-prisma provider passes state provider conformance", async () => {
  await runSqliteStateProviderConformance(async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "queuert-sqlite-prisma-spec-"));
    const dbPath = join(tempDir, "test.db");

    process.env.DATABASE_URL = `file:${dbPath}`;
    execSync("npx prisma db push", { stdio: "inherit", cwd: EXAMPLE_DIR });

    const { PrismaClient } = await import("../prisma/generated/prisma/client.ts");
    const prismaAdapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
    const prisma = new PrismaClient({ adapter: prismaAdapter });

    const lock = createAsyncRwLock();
    const stateProvider = createPrismaSqliteStateProvider({ prisma, lock });

    return {
      stateProvider,
      withNonTransactionContext: async (fn) => fn({ prisma }),
      dispose: async () => {
        await prisma.$disconnect();
        rmSync(tempDir, { recursive: true, force: true });
      },
    };
  });
}, 60_000);
// #endregion
