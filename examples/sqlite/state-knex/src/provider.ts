import type { SqliteStateProvider } from "@queuert/sqlite";
import type { Knex } from "knex";
import { type TxHooks, withTxHooks } from "queuert";

export type KnexSqliteContext = { trx: Knex.Transaction; txHooks: TxHooks };

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
    getTransaction: (txCtx) =>
      txCtx.trx.isTransaction === true && txCtx.txHooks.isOpen ? txCtx.txHooks : undefined,
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
    executeSql: async ({ txCtx, sql, params }) => {
      const result: unknown = await (txCtx?.trx ?? knex).raw(sql, params as Knex.RawBinding[]);
      return Array.isArray(result) ? result : [];
    },
  };
};
