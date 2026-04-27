import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";

const pg = await acquirePostgres("postgres:18", import.meta.url);
export const sql = postgres(pg.connectionString, { max: 10 });

const stateProvider = createPostgresJsStateProvider({ sql });
export const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
export const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

export const stopContainer = async () => {
  await notifyAdapter.close();
  await stateAdapter.close();
  await sql.end();
  await pg[Symbol.asyncDispose]();
};
