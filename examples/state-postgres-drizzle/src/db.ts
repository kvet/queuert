import { ExtractTablesWithRelations, sql } from "drizzle-orm";
import { drizzle, NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { PgTransaction } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./db-schema.js";

export const createDb = async ({ connectionString }: { connectionString: string }) => {
  const pool = new Pool({
    connectionString,
    max: 10,
  });

  const db = drizzle(pool, { schema });

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pet (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL
    )
  `);

  return db;
};

export type Db = NodePgDatabase<typeof schema>;
export type DbTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
