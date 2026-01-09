import { PrismaClient } from "@prisma/client";
import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { createRedisNotifyAdapter, RedisNotifyProvider } from "@queuert/redis";
import { createConsoleLog, createQueuert } from "queuert";
import { PrismaTransactionClient } from "./prisma.js";
import { qrtJobDefinitions } from "./qrt-schema.js";
import { Redis } from "./redis.js";

export const createQrt = async ({
  prisma,
  redis,
  redisSubscription,
}: {
  prisma: PrismaClient;
  redis: Redis;
  redisSubscription: Redis;
}) => {
  const stateProvider: PgStateProvider<
    { prisma: PrismaTransactionClient },
    { prisma: PrismaClient }
  > = {
    provideContext: async (cb) => cb({ prisma }),
    isInTransaction: async ({ prisma }) => {
      return !("$transaction" in prisma);
    },
    runInTransaction: async ({ prisma }, cb) => {
      return prisma.$transaction(async (tx) => cb({ prisma: tx }));
    },
    executeSql: async ({ prisma }, query, params) => {
      // Prisma's $queryRawUnsafe only supports single statements (uses prepared statements)
      // For multi-statement queries (like migrations), we need to split and execute each
      if (params && params.length > 0) {
        // Parameterized query - must be single statement
        return (prisma as any).$queryRawUnsafe(query, ...params);
      }

      // Split SQL into statements, respecting dollar-quoted strings (DO $$ ... $$)
      const splitStatements = (sql: string): string[] => {
        const statements: string[] = [];
        let current = "";
        let i = 0;

        while (i < sql.length) {
          // Check for dollar-quote start ($$)
          if (sql[i] === "$" && sql[i + 1] === "$") {
            current += "$$";
            i += 2;
            // Find matching $$
            while (i < sql.length) {
              if (sql[i] === "$" && sql[i + 1] === "$") {
                current += "$$";
                i += 2;
                break;
              }
              current += sql[i];
              i++;
            }
          } else if (sql[i] === ";") {
            // Statement terminator
            const stmt = current.trim();
            if (stmt.length > 0) {
              statements.push(stmt);
            }
            current = "";
            i++;
          } else {
            current += sql[i];
            i++;
          }
        }

        const lastStmt = current.trim();
        if (lastStmt.length > 0) {
          statements.push(lastStmt);
        }

        return statements;
      };

      const statements = splitStatements(query);

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
          result = await (prisma as any).$queryRawUnsafe(statement);
        } else {
          await (prisma as any).$executeRawUnsafe(statement);
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

  const notifyProvider: RedisNotifyProvider<{ redis: Redis }> = {
    provideContext: async (type, cb) => {
      switch (type) {
        case "command":
          return cb({ redis });
        case "subscribe":
          return cb({ redis: redisSubscription });
      }
    },
    publish: async ({ redis }, channel, message) => {
      await redis.publish(channel, message);
    },
    subscribe: async ({ redis }, channel, onMessage) => {
      await redis.subscribe(channel, onMessage);
      return async () => {
        await redis.unsubscribe(channel);
      };
    },
    eval: async ({ redis }, script, keys, args) => {
      return redis.eval(script, { keys, arguments: args });
    },
  };
  const notifyAdapter = await createRedisNotifyAdapter({
    provider: notifyProvider,
  });

  return createQueuert({
    stateAdapter,
    notifyAdapter,
    log: createConsoleLog(),
    jobTypeDefinitions: qrtJobDefinitions,
  });
};

export type Qrt = Awaited<ReturnType<typeof createQrt>>;
