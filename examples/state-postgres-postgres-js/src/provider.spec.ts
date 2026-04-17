import { createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { type PostgresJsContext, createPostgresJsStateProvider } from "./provider.js";

test("state-postgres-postgres-js provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const container = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();
    const sql = postgres(container.getConnectionUri(), { max: 10 });

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
        await container.stop();
      },
    };
  });
}, 300_000);
