import { type SqliteStateProvider } from "@queuert/sqlite";
import { CompiledQuery, type Kysely } from "kysely";

export type KyselySqliteContext<TDatabase> = { db: Kysely<TDatabase> };

// Kysely's dialect for better-sqlite3 uses a pool of size 1 and holds that
// connection for the duration of `db.transaction().execute()`. Non-tx queries
// block on `acquireConnection` until the tx releases it, so no extra lock is
// needed to serialize writers.
export const createKyselySqliteStateProvider = <TDatabase>({
  db,
}: {
  db: Kysely<TDatabase>;
}): SqliteStateProvider<KyselySqliteContext<TDatabase>> => {
  return {
    withTransaction: async (cb) =>
      db.transaction().execute(async (txDb) => cb({ db: txDb as Kysely<TDatabase> })),
    // `id` not forwarded: Kysely's better-sqlite3 dialect re-prepares every raw
    // query; no hook to cache through the dialect. Bypass Kysely for statement
    // caching (see state-sqlite-better-sqlite3).
    executeSql: async ({ txCtx, sql, params }) => {
      const database = txCtx?.db ?? db;
      const result = await database.executeQuery(CompiledQuery.raw(sql, params));
      return result.rows;
    },
  };
};
