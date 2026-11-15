import type { PgStateProvider } from "@queuert/postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { PgTransaction } from "drizzle-orm/pg-core";
import { type TxHooks, withTxHooks } from "queuert";

export type DrizzlePgTransaction<TSchema extends Record<string, unknown>> = PgTransaction<
  NodePgQueryResultHKT,
  TSchema,
  ExtractTablesWithRelations<TSchema>
>;
export type DrizzlePgContext<TSchema extends Record<string, unknown>> = {
  tx: DrizzlePgTransaction<TSchema>;
  txHooks: TxHooks;
};

export const createDrizzlePgStateProvider = <TSchema extends Record<string, unknown>>({
  db,
  prepareStatements = true,
}: {
  db: NodePgDatabase<TSchema>;
  /**
   * When true (default), queries that arrive with an `id` are sent as named
   * prepared statements via the underlying pg client (`name = id`). Set to
   * `false` for transaction-mode poolers (PgBouncer, Supavisor).
   */
  prepareStatements?: boolean;
}): PgStateProvider<DrizzlePgContext<TSchema>> => {
  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) =>
        db.transaction(async (tx) => cb({ tx, txHooks }), { isolationLevel: "read committed" }),
      ),
    isTransaction: (txCtx) => txCtx.tx instanceof PgTransaction,
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      type DriverError = { code?: unknown; message?: unknown; cause?: DriverError };
      const driverError = [
        error as DriverError | undefined,
        (error as DriverError | undefined)?.cause,
      ].find((candidate) => candidate?.code === "42P01");
      if (driverError === undefined) return undefined;
      const tableName = /relation "([^"]+)" does not exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, id, sql, params }) => {
      // Inside transaction: access Drizzle's internal pg client
      // Outside transaction (migrations): use db.$client (the pool)
      const client = txCtx ? (txCtx.tx as any).session.client : (db as any).$client;
      if (id !== undefined && prepareStatements) {
        const result = await client.query({ name: id, text: sql, values: params });
        return result.rows;
      }
      const result = await client.query(sql, params);
      return result.rows;
    },
  };
};
