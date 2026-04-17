import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { type PostgresJsContext, createPostgresJsStateProvider } from "./provider.js";

test("state-postgres-postgres-js provider passes state adapter conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runStateAdapterConformance(async () => {
    const sql = postgres(pg.connectionString, { max: 10 });

    const stateProvider = createPostgresJsStateProvider({ sql });
    const adapter = await createPgStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      poisonTransaction: async (txCtx: PostgresJsContext) => {
        await txCtx.sql.unsafe("SELECT 1 FROM nonexistent_table_queuert_poison_xyz");
      },
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await sql.end();
      },
    };
  });
}, 60_000);
