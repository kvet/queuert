import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { createConsoleLog, createQueuert } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { Db, DbTransaction } from "./db.js";
import { qrtJobTypeDefinitions } from "./qrt-schema.js";

export const createQrt = async ({ db }: { db: Db }) => {
  const stateProvider: PgStateProvider<{ tx: DbTransaction }> = {
    runInTransaction: async (cb) => {
      return db.transaction(async (tx) => cb({ tx }));
    },
    executeSql: async ({ txContext, sql, params }) => {
      // Inside transaction: access Drizzle's internal pg client
      // Outside transaction (migrations): use db.$client (the pool)
      const client = txContext ? (txContext.tx as any).session.client : (db as any).$client;
      const result = await client.query(sql, params);
      return result.rows;
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
