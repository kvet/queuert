import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";

export const adapterResources = new AsyncDisposableStack();
const pg = adapterResources.use(await acquirePostgres("postgres:18", import.meta.url));
export const sql = adapterResources.adopt(postgres(pg.connectionString, { max: 10 }), async (sql) =>
  sql.end(),
);

const stateProvider = createPostgresJsStateProvider({ sql });
export const stateAdapter = adapterResources.use(createPgStateAdapter({ stateProvider }));
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
export const notifyAdapter = adapterResources.use(createPgNotifyAdapter({ notifyProvider }));
