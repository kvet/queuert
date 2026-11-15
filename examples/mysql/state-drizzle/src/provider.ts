import type { MysqlStateProvider } from "@queuert/mysql";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { MySqlTransaction } from "drizzle-orm/mysql-core";
import type {
  MySql2Database,
  MySql2PreparedQueryHKT,
  MySql2QueryResultHKT,
} from "drizzle-orm/mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import { type TxHooks, withTxHooks } from "queuert";

export type DrizzleMysqlTransaction<TSchema extends Record<string, unknown>> = MySqlTransaction<
  MySql2QueryResultHKT,
  MySql2PreparedQueryHKT,
  TSchema,
  ExtractTablesWithRelations<TSchema>
>;
export type DrizzleMysqlContext<TSchema extends Record<string, unknown>> = {
  tx: DrizzleMysqlTransaction<TSchema>;
  txHooks: TxHooks;
};

export const createDrizzleMysqlStateProvider = <TSchema extends Record<string, unknown>>({
  db,
}: {
  db: MySql2Database<TSchema> & { $client: Pool };
}): MysqlStateProvider<DrizzleMysqlContext<TSchema>> => {
  const exec = async (
    connection: Pool | PoolConnection,
    id: string | undefined,
    sql: string,
    params: unknown[],
  ): Promise<unknown[]> => {
    const [rows] =
      id !== undefined
        ? await connection.execute(sql, params as never[])
        : await connection.query(sql, params);
    return Array.isArray(rows) ? rows : [];
  };

  return {
    withTransaction: async (cb) =>
      withTxHooks(async (txHooks) =>
        db.transaction(async (tx) => cb({ tx, txHooks }), { isolationLevel: "read committed" }),
      ),
    isTransaction: (txCtx) => txCtx.tx instanceof MySqlTransaction,
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },
    classifyError: ({ error }) => {
      type DriverError = { errno?: unknown; message?: unknown; cause?: DriverError };
      const driverError = [
        error as DriverError | undefined,
        (error as DriverError | undefined)?.cause,
      ].find((candidate) => candidate?.errno === 1146);
      if (driverError === undefined) return undefined;
      const tableName = /Table '([^']+)' doesn't exist/.exec(String(driverError.message))?.[1];
      return tableName === undefined ? undefined : { kind: "undefined_table", tableName };
    },
    executeSql: async ({ txCtx, id, sql, params }) =>
      // Inside transaction: the connection Drizzle's session checked out of the pool
      // Outside transaction (migrations): db.$client (the pool)
      exec(txCtx ? (txCtx.tx as any).session.client : db.$client, id, sql, params),
  };
};
