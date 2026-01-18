import { createPgStateAdapter, PgStateProvider } from "@queuert/postgres";
import { createConsoleLog, createQueuert } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";
import { qrtJobTypeDefinitions } from "./qrt-schema.js";
import { Sql, TransactionSql } from "./sql.js";

export const createQrt = async ({ sql }: { sql: Sql }) => {
  const stateProvider: PgStateProvider<{ sql: TransactionSql }> = {
    runInTransaction: async (cb) => {
      let result: any;
      await sql.begin(async (txSql) => {
        result = await cb({ sql: txSql as TransactionSql });
      });
      return result;
    },
    executeSql: async ({ txContext, sql: query, params }) => {
      const sqlClient = txContext?.sql ?? sql;
      const normalizedParams = params
        ? (params as any[]).map((p) => (p === undefined ? null : p))
        : [];
      const result = await sqlClient.unsafe(query, normalizedParams);
      return result as any;
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
