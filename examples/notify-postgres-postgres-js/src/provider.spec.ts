import { runPgNotifyProviderConformance } from "@queuert/postgres/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import { test } from "vitest";

import { createPostgresJsNotifyProvider } from "./provider.ts";

// #region conformance
test("notify-postgres-postgres-js provider passes notify provider conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runPgNotifyProviderConformance(async () => {
    const sql = postgres(pg.connectionString, { max: 10 });
    const notifyProvider = createPostgresJsNotifyProvider({ sql });

    return {
      notifyProvider,
      dispose: async () => {
        await sql.end();
      },
    };
  });
}, 60_000);
// #endregion
