import type { SqliteStateProvider } from "@queuert/sqlite";
import type { Knex } from "knex";
import { type TxHooks, withTxHooks } from "queuert";

export type KnexSqliteContext = { trx: Knex.Transaction; txHooks: TxHooks };

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
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) =>
        knex.transaction(async (trx) => cb({ trx, txHooks }), { doNotRejectOnRollback: false }),
      ),
    isTransaction: (txCtx) => txCtx.trx.isTransaction === true,
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      const tableName = /no such table: (\S+)/.exec(
        String((error as { message?: unknown } | undefined)?.message),
      )?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
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
