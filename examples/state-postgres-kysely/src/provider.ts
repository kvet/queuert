import { type PgStateProvider } from "@queuert/postgres";
import { CompiledQuery, type Kysely } from "kysely";

export type KyselyPgContext<TDatabase> = { db: Kysely<TDatabase> };

export const createKyselyPgStateProvider = <TDatabase>({
  db,
}: {
  db: Kysely<TDatabase>;
}): PgStateProvider<KyselyPgContext<TDatabase>> => {
  return {
    withTransaction: async (cb) =>
      db.transaction().execute(async (txDb) => cb({ db: txDb as Kysely<TDatabase> })),
    // `id` not forwarded: Kysely's CompiledQuery.raw has no name field; the pg
    // dialect calls `client.query(sql, params)` unprepared. Bypass Kysely for
    // server-side prepared statements (see state-postgres-pg).
    executeSql: async ({ txCtx, sql, params }) => {
      if (txCtx && !txCtx.db.isTransaction) {
        throw new Error("Provided context is not in a transaction");
      }
      const result = await (txCtx?.db ?? db).executeQuery(CompiledQuery.raw(sql, params));
      return result.rows;
    },
  };
};
