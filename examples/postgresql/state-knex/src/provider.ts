import type { PgStateProvider } from "@queuert/postgres";
import type { Knex } from "knex";
import { type TxHooks, withTxHooks } from "queuert";

export type KnexPgContext = { trx: Knex.Transaction; txHooks: TxHooks };

const POSITIONAL_PARAM = /\$(\d+)/g;

const toKnexQuery = (
  sql: string,
  params: unknown[],
): { sql: string; bindings: Knex.RawBinding[] } => {
  const bindings: Knex.RawBinding[] = [];
  const rewritten = sql.replace(POSITIONAL_PARAM, (_match, position: string) => {
    bindings.push((params[Number(position) - 1] ?? null) as Knex.RawBinding);
    return "?";
  });
  return { sql: rewritten, bindings };
};

export const createKnexPgStateProvider = ({
  knex,
}: {
  knex: Knex;
}): PgStateProvider<KnexPgContext> => {
  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) =>
        knex.transaction(async (trx) => cb({ trx, txHooks }), {
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
      const driverError = error as { code?: unknown; message?: unknown } | undefined;
      if (driverError?.code === "40001" || driverError?.code === "40P01")
        return { kind: "transaction_conflict" };
      if (driverError?.code === "55P03") return { kind: "lock_not_available" };
      if (driverError?.code !== "42P01") return undefined;
      const tableName = /relation "([^"]+)" does not exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, sql, params }) => {
      const query = toKnexQuery(sql, params);
      const result = await (txCtx?.trx ?? knex).raw(query.sql, query.bindings);
      return result.rows;
    },
  };
};
