import { type SqliteStateProvider } from "@queuert/sqlite";
import { type Knex } from "knex";

export type KnexSqliteContext = { trx: Knex.Transaction };

// Knex's sqlite dialects default to a pool of size 1 and hold that connection
// for the duration of `knex.transaction()`. Non-tx queries block on connection
// acquisition until the tx releases it, so no extra lock is needed to
// serialize writers.
export const createKnexSqliteStateProvider = ({
  knex,
}: {
  knex: Knex;
}): SqliteStateProvider<KnexSqliteContext> => {
  return {
    transactionConcurrency: "serialized",
    withTransaction: async (cb) => knex.transaction(async (trx) => cb({ trx })),
    // `id` not forwarded: knex re-prepares every raw query and exposes no hook
    // to cache statement handles through the dialect. Bypass knex for statement
    // caching (see state-sqlite-better-sqlite3).
    executeSql: async ({ txCtx, sql, params }) => {
      // The better-sqlite3 dialect returns rows for read statements and a
      // `{ changes, lastInsertRowid }` summary for writes.
      const result: unknown = await (txCtx?.trx ?? knex).raw(sql, params as Knex.RawBinding[]);
      return Array.isArray(result) ? result : [];
    },
  };
};
