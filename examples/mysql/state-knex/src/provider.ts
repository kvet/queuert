import type { MysqlStateProvider } from "@queuert/mysql";
import type { Knex } from "knex";
import { type TxHooks, withTxHooks } from "queuert";

export type KnexMysqlContext = { trx: Knex.Transaction; txHooks: TxHooks };

export const createKnexMysqlStateProvider = ({
  knex,
}: {
  knex: Knex;
}): MysqlStateProvider<KnexMysqlContext> => {
  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) =>
        knex.transaction(async (trx) => cb({ trx, txHooks }), {
          isolationLevel: "read committed",
          doNotRejectOnRollback: false,
        }),
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
      const driverError = error as { errno?: unknown; sqlMessage?: unknown } | undefined;
      if (driverError?.errno === 1213 || driverError?.errno === 1020) {
        return { kind: "transaction_conflict" };
      }
      if (driverError?.errno !== 1146) return undefined;
      const tableName = /Table '([^']+)' doesn't exist/.exec(String(driverError.sqlMessage))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    // `id` not forwarded: knex sends every `raw` call unprepared.
    executeSql: async ({ txCtx, sql, params }) => {
      // Knex rejects `undefined` bindings outright; mysql2 treats them as NULL.
      const bindings = params.map((param) => (param ?? null) as Knex.RawBinding);
      const [rows] = await (txCtx?.trx ?? knex).raw(sql, bindings);
      return Array.isArray(rows) ? rows : [];
    },
  };
};
