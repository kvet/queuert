import {
  createPgStateProviderConformanceContext,
  type PgStateProviderConformanceContext,
  pgStateProviderConformanceCases,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createKyselyPgStateProvider } from "./provider.ts";

type Database = Record<string, never>;

// #region conformance
describe("state-postgres-kysely provider conformance", () => {
  let pg: AcquiredPostgres;
  let db: Kysely<Database>;
  let context: PgStateProviderConformanceContext;

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    const kysely = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    db = kysely;
    context = await createPgStateProviderConformanceContext({
      createStateProvider: async () => createKyselyPgStateProvider({ db: kysely }),
      withNonTransactionContext: async (fn) => fn({ db: kysely }),
    });
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of pgStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion
