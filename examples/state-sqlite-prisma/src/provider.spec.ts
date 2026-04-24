import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createPrismaSqliteStateProvider } from "./provider.js";

const EXAMPLE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

test("state-sqlite-prisma provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "queuert-sqlite-prisma-spec-"));
    const dbPath = join(tempDir, "test.db");

    const initDb = new Database(dbPath);
    initDb.pragma("auto_vacuum = INCREMENTAL");
    initDb.close();

    process.env.DATABASE_URL = `file:${dbPath}`;
    execSync("npx prisma db push", { stdio: "inherit", cwd: EXAMPLE_DIR });

    const { PrismaClient } = await import("../prisma/generated/prisma/client.js");
    const prismaAdapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
    const prisma = new PrismaClient({ adapter: prismaAdapter });

    const db = new Database(dbPath);

    const lock = createAsyncRwLock();
    const stateProvider = createPrismaSqliteStateProvider({ prisma, lock });
    const adapter = await createSqliteStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await prisma.$disconnect();
        db.close();
        rmSync(tempDir, { recursive: true, force: true });
      },
    };
  });
}, 60_000);
