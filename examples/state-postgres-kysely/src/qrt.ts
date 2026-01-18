import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { CompiledQuery } from "kysely";
import { createConsoleLog, createQueuert } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { Db } from "./db.js";
import { qrtJobTypeDefinitions } from "./qrt-schema.js";

export const createQrt = async ({ db }: { db: Db }) => {
  const stateProvider: PgStateProvider<{ db: Db }> = {
    runInTransaction: async (cb) => db.transaction().execute(async (txDb) => cb({ db: txDb })),
    executeSql: async ({ txContext, sql, params }) => {
      if (txContext && !txContext.db.isTransaction) {
        throw new Error("Provided context is not in a transaction");
      }
      const result = await (txContext?.db ?? db).executeQuery(CompiledQuery.raw(sql, params));
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
