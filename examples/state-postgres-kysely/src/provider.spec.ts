import { createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createKyselyPgStateProvider } from "./provider.js";

type Database = Record<string, never>;

test("state-postgres-kysely provider passes state adapter conformance", async () => {
  await using pg = await acquirePostgres("postgres:18", import.meta.url);

  await runStateAdapterConformance(async () => {
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

    const stateProvider = createKyselyPgStateProvider({ db });
    const adapter = await createPgStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      transactionConcurrency: "concurrent",
      withNonTransactionContext: async (fn) => fn({ db }),
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await db.destroy();
      },
    };
  });
}, 60_000);
