import { type PgStateProvider } from "@queuert/postgres";
import { CompiledQuery, type Kysely } from "kysely";

import { type KyselyPgContext, type KyselyTransactions } from "./transaction.js";

export const createKyselyPgStateProvider = <TDatabase>({
  db,
  transactions,
}: {
  db: Kysely<TDatabase>;
  transactions: KyselyTransactions<TDatabase>;
}): PgStateProvider<KyselyPgContext<TDatabase>, "implicit"> => ({
  withTransaction: transactions.transaction,
  isTransaction: (txCtx) => txCtx.db.isTransaction,
  getTransactionHooks: (txCtx) => transactions.getTransactionHooks(txCtx.db),
  executeSql: async ({ txCtx, sql, params }) => {
    if (txCtx && !txCtx.db.isTransaction) {
      throw new Error("Provided context is not in a transaction");
    }
    const result = await (txCtx?.db ?? db).executeQuery(CompiledQuery.raw(sql, params));
    return result.rows;
  },
});
