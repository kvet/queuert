import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";

const pgContainer = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();
export const sql = postgres(pgContainer.getConnectionUri(), { max: 10 });

const stateProvider = createPostgresJsStateProvider({ sql });
export const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
export const notifyAdapter = await createPgNotifyAdapter({ provider: notifyProvider });

export const stopContainer = async () => {
  await sql.end();
  await pgContainer.stop();
};
