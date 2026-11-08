import { runPgStateProviderConformance } from "@queuert/postgres/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import { test } from "vitest";

import { createPostgresJsStateProvider } from "./provider.ts";

// #region conformance
test("state-postgres-postgres-js provider passes state provider conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runPgStateProviderConformance(async () => {
    const sql = postgres(pg.connectionString, { max: 10 });

    const stateProvider = createPostgresJsStateProvider({ sql });

    return {
      stateProvider,
      withNonTransactionContext: async (fn) => fn({ txSql: sql }),
      dispose: async () => {
        await sql.end();
      },
    };
  });
}, 60_000);
// #endregion
