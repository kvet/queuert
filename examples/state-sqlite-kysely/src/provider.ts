import { type AsyncLock, type SqliteStateProvider } from "@queuert/sqlite";
import { CompiledQuery, type Kysely } from "kysely";

export type KyselySqliteContext<TDatabase> = { db: Kysely<TDatabase> };

export const createKyselySqliteStateProvider = <TDatabase>({
  db,
  lock,
}: {
  db: Kysely<TDatabase>;
  lock: AsyncLock;
}): SqliteStateProvider<KyselySqliteContext<TDatabase>> => {
  return {
    withTransaction: async (cb) => {
      await lock.acquire();
      try {
        return await db
          .transaction()
          .execute(async (txDb) => cb({ db: txDb as Kysely<TDatabase> }));
      } finally {
        lock.release();
      }
    },
    executeSql: async ({ txCtx, sql, params }) => {
      const database = txCtx?.db ?? db;
      const result = await database.executeQuery(CompiledQuery.raw(sql, params));
      return result.rows;
    },
  };
};
