import { runPgStateProviderConformance } from "@queuert/postgres/conformance";
import { acquirePostgres } from "@queuert/testcontainers";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { test } from "vitest";

import { createKyselyPgStateProvider } from "./provider.ts";

type Database = Record<string, never>;

// #region conformance
test("state-postgres-kysely provider passes state provider conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runPgStateProviderConformance(async () => {
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

    const stateProvider = createKyselyPgStateProvider({ db });

    return {
      stateProvider,
      withNonTransactionContext: async (fn) => fn({ db }),
      dispose: async () => {
        await db.destroy();
      },
    };
  });
}, 60_000);
// #endregion
