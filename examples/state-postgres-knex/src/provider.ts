import type { PgStateProvider } from "@queuert/postgres";
import type { Knex } from "knex";
import { type TxHooks, withTxHooks } from "queuert";

export type KnexPgContext = { trx: Knex.Transaction; txHooks: TxHooks };

const POSITIONAL_PARAM = /\$(\d+)/g;

// Knex only understands `?` placeholders and throws when the binding count
// doesn't match, so the adapter's `$n` form has to be rewritten. Bindings are
// rebuilt in occurrence order, which also covers templates that reference the
// same `$n` twice (e.g. keyset pagination predicates). Dollar-quoted blocks
// (`DO $$ ... $$`) carry no digits and are left untouched.
const toKnexQuery = (
  sql: string,
  params: unknown[],
): { sql: string; bindings: Knex.RawBinding[] } => {
  const bindings: Knex.RawBinding[] = [];
  const rewritten = sql.replace(POSITIONAL_PARAM, (_match, position: string) => {
    // Knex rejects `undefined` bindings outright; pg treats them as NULL.
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
      const driverError = error as { code?: unknown; message?: unknown } | undefined;
      if (driverError?.code !== "42P01") return undefined;
      const tableName = /relation "([^"]+)" does not exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    // `id` not forwarded: knex has no server-side prepared statement support —
    // every `raw` call is sent unprepared. Bypass knex for prepared statements
    // (see state-postgres-pg).
    executeSql: async ({ txCtx, sql, params }) => {
      const query = toKnexQuery(sql, params);
      const result = await (txCtx?.trx ?? knex).raw(query.sql, query.bindings);
      return result.rows;
    },
  };
};
