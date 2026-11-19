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
    isTransaction: (txCtx) => txCtx.trx.isTransaction === true,
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      const driverError = error as { errno?: unknown; sqlMessage?: unknown } | undefined;
      if (driverError?.errno !== 1146) return undefined;
      const tableName = /Table '([^']+)' doesn't exist/.exec(String(driverError.sqlMessage))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    // `id` not forwarded: knex sends every `raw` call unprepared.
    executeStatements: async ({ txCtx, statements }) => {
      const results: unknown[][] = [];
      for (const { sql, params } of statements) {
        // Knex rejects `undefined` bindings outright; mysql2 treats them as NULL.
        const bindings = params.map((param) => (param ?? null) as Knex.RawBinding);
        const [rows] = await (txCtx?.trx ?? knex).raw(sql, bindings);
        results.push(Array.isArray(rows) ? rows : []);
      }
      return results;
    },
  };
};
