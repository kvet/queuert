import { PrismaClient } from "@prisma/client";
import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { createConsoleLog, createQueuert } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { PrismaTransactionClient } from "./prisma.js";
import { qrtJobTypeDefinitions } from "./qrt-schema.js";

export const createQrt = async ({ prisma }: { prisma: PrismaClient }) => {
  const stateProvider: PgStateProvider<{ prisma: PrismaTransactionClient }> = {
    runInTransaction: async (cb) => {
      return prisma.$transaction(async (prisma) => cb({ prisma }));
    },
    executeSql: async ({ txContext, sql, params }) => {
      const prismaClient = txContext?.prisma ?? prisma;

      // Prisma's $queryRawUnsafe only supports single statements (uses prepared statements)
      // For multi-statement queries (like migrations), we need to split and execute each
      if (params && params.length > 0) {
        // Parameterized query - must be single statement
        return (prismaClient as any).$queryRawUnsafe(sql, ...params);
      }

      // Split SQL into statements, respecting dollar-quoted strings (DO $$ ... $$)
      const splitStatements = (sqlQuery: string): string[] => {
        const statements: string[] = [];
        let current = "";
        let i = 0;

        while (i < sqlQuery.length) {
          // Check for dollar-quote start ($$)
          if (sqlQuery[i] === "$" && sqlQuery[i + 1] === "$") {
            current += "$$";
            i += 2;
            // Find matching $$
            while (i < sqlQuery.length) {
              if (sqlQuery[i] === "$" && sqlQuery[i + 1] === "$") {
                current += "$$";
                i += 2;
                break;
              }
              current += sqlQuery[i];
              i++;
            }
          } else if (sqlQuery[i] === ";") {
            // Statement terminator
            const stmt = current.trim();
            if (stmt.length > 0) {
              statements.push(stmt);
            }
            current = "";
            i++;
          } else {
            current += sqlQuery[i];
            i++;
          }
        }

        const lastStmt = current.trim();
        if (lastStmt.length > 0) {
          statements.push(lastStmt);
        }

        return statements;
      };

      const statements = splitStatements(sql);

      let result: unknown[] = [];
      for (const statement of statements) {
        // Strip single-line comments (-- ...) from start of statement
        const strippedStatement = statement
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim();

        // Skip empty statements (only comments)
        if (strippedStatement.length === 0) continue;

        // Use $executeRawUnsafe for DDL/DML, $queryRawUnsafe for SELECT
        const isSelect = /^\s*SELECT\b/i.test(strippedStatement);
        if (isSelect) {
          result = await (prismaClient as any).$queryRawUnsafe(statement);
        } else {
          await (prismaClient as any).$executeRawUnsafe(statement);
        }
      }
      return result;
    },
  };
  const stateAdapter = await createPgStateAdapter({
    stateProvider,
    schema: "public",
    // Prisma v4+ removed implicit type coercion, so $queryRawUnsafe doesn't cast
    // string parameters to UUID, causing "operator does not exist: uuid = text".
    // Using TEXT is the recommended workaround. See: https://github.com/prisma/prisma/issues/16969
    idType: "text",
    idDefault: "gen_random_uuid()::text",
  });

  await stateAdapter.migrateToLatest();

  const notifyAdapter = createInProcessNotifyAdapter();

  return createQueuert({
    stateAdapter,
    notifyAdapter,
    log: createConsoleLog(),
    jobTypeRegistry: qrtJobTypeDefinitions,
  });
};

export type Qrt = Awaited<ReturnType<typeof createQrt>>;
