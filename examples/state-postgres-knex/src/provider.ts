import { type PgStateProvider } from "@queuert/postgres";
import { type Knex } from "knex";

export type KnexPgContext = { trx: Knex.Transaction };

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
    transactionConcurrency: "concurrent",
    withTransaction: async (cb) => knex.transaction(async (trx) => cb({ trx })),
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
