import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { PoolClient } from "pg";
import { createConsoleLog, createQueuert } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { Db } from "./db.js";
import { qrtJobTypeDefinitions } from "./qrt-schema.js";

export type DbContext = { poolClient: PoolClient };

export const createQrt = async ({ db }: { db: Db }) => {
  const stateProvider: PgStateProvider<DbContext> = {
    runInTransaction: async (cb) => {
      const poolClient = await db.connect();
      try {
        await poolClient.query("BEGIN");
        const result = await cb({ poolClient });
        await poolClient.query("COMMIT");
        return result;
      } catch (error) {
        await poolClient.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        poolClient.release();
      }
    },
    executeSql: async ({ txContext, sql, params }) => {
      if (txContext) {
        const result = await txContext.poolClient.query(sql, params);
        return result.rows;
      }
      const poolClient = await db.connect();
      try {
        const result = await poolClient.query(sql, params);
        return result.rows;
      } finally {
        poolClient.release();
      }
    },
  };
  const stateAdapter = await createPgStateAdapter({
    stateProvider,
    schema: "public",
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
