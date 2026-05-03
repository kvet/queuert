import { type PgStateProvider } from "@queuert/postgres";
import { type ExtractTablesWithRelations } from "drizzle-orm";
import { type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { type PgTransaction } from "drizzle-orm/pg-core";

export type DrizzlePgTransaction<TSchema extends Record<string, unknown>> = PgTransaction<
  NodePgQueryResultHKT,
  TSchema,
  ExtractTablesWithRelations<TSchema>
>;
export type DrizzlePgContext<TSchema extends Record<string, unknown>> = {
  tx: DrizzlePgTransaction<TSchema>;
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
    withTransaction: async (cb) => {
      return db.transaction(async (tx) => cb({ tx: tx as DrizzlePgTransaction<TSchema> }));
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
