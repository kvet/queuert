import { Pool, PoolClient } from "pg";

export const createDb = async ({ connectionString }: { connectionString: string }) => {
  const pool = new Pool({
    connectionString,
    max: 10,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pet (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL
    );
  `);

  return pool;
};

export type Db = Pool;
export type DbClient = PoolClient;
