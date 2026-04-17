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
}: {
  db: NodePgDatabase<TSchema>;
}): PgStateProvider<DrizzlePgContext<TSchema>> => {
  return {
    withTransaction: async (cb) => {
      return db.transaction(async (tx) => cb({ tx: tx as DrizzlePgTransaction<TSchema> }));
    },
    executeSql: async ({ txCtx, sql, params }) => {
      // Inside transaction: access Drizzle's internal pg client
      // Outside transaction (migrations): use db.$client (the pool)
      const client = txCtx ? (txCtx.tx as any).session.client : (db as any).$client;
      const result = await client.query(sql, params);
      return result.rows;
    },
  };
};
