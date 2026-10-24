import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createPostgresJsStateProvider } from "./provider.js";

test("state-postgres-postgres-js provider passes state adapter conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runStateAdapterConformance(async () => {
    const sql = postgres(pg.connectionString, { max: 10 });

    const stateProvider = createPostgresJsStateProvider({ sql });
    const adapter = await createPgStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      transactionConcurrency: "concurrent",
      withNonTransactionContext: async (fn) => fn({ txSql: sql }),
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await sql.end();
      },
    };
  });
}, 60_000);
