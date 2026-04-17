import { createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { CompiledQuery, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { type KyselyPgContext, createKyselyPgStateProvider } from "./provider.js";

type Database = Record<string, never>;

test("state-postgres-kysely provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const container = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();
    const pool = new Pool({ connectionString: container.getConnectionUri(), idleTimeoutMillis: 0 });
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

    const stateProvider = createKyselyPgStateProvider({ db });
    const adapter = await createPgStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      poisonTransaction: async (txCtx: KyselyPgContext<Database>) => {
        await txCtx.db.executeQuery(
          CompiledQuery.raw("SELECT 1 FROM nonexistent_table_queuert_poison_xyz"),
        );
      },
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await db.destroy();
        await container.stop();
      },
    };
  });
}, 300_000);
