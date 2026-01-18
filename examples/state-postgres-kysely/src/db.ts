import { CompiledQuery, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { Database } from "./db-schema.js";

export const createDb = async ({ connectionString }: { connectionString: string }) => {
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: 10,
      }),
    }),
  });

  await db.executeQuery(
    CompiledQuery.raw(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pet (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL
    );
  `),
  );

  return db;
};

export type Db = Awaited<ReturnType<typeof createDb>>;
