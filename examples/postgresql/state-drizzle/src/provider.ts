import type { PgStateProvider } from "@queuert/postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { PgTransaction } from "drizzle-orm/pg-core";
import type { Pool, PoolClient } from "pg";
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
  db: NodePgDatabase<TSchema> & { $client: Pool };
  /**
   * When true (default), queries that arrive with an `id` are sent as named
   * prepared statements via the underlying pg client (`name = id`). Set to
   * `false` for transaction-mode poolers (PgBouncer, Supavisor).
   */
  prepareStatements?: boolean;
}): PgStateProvider<DrizzlePgContext<TSchema>> => {
  const execute = async (
    client: PoolClient,
    { id, sql, params }: { id?: string; sql: string; params: unknown[] },
  ): Promise<unknown[]> => {
    const result =
      id !== undefined && prepareStatements
        ? await client.query({ name: id, text: sql, values: params })
        : await client.query(sql, params);
    return result.rows;
  };

  const executeBatch = async (
    client: PoolClient,
    statements: { id?: string; sql: string; params: unknown[] }[],
  ): Promise<unknown[][]> => {
    const results = await Promise.allSettled(
      statements.map(async (statement) => execute(client, statement)),
    );
    return results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
  };

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
    executeStatements: async ({ txCtx, statements }) => {
      if (txCtx) return executeBatch((txCtx.tx as any).session.client, statements);
      const poolClient = await db.$client.connect();
      try {
        return await executeBatch(poolClient, statements);
      } finally {
        poolClient.release();
      }
    },
  };
};
