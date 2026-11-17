import {
  createPgMigratorConformanceContext,
  createPgStateProviderConformanceContext,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, test } from "vitest";

import { createKyselyPgStateProvider } from "./provider.ts";

type Database = Record<string, never>;

// #region conformance
describe("postgresql/state-kysely provider conformance", () => {
  let pg: AcquiredPostgres;
  let db: Kysely<Database>;
  const { context, cases } = createPgStateProviderConformanceContext({
    isolationLevel: "READ COMMITTED",
    createStateProvider: async () => createKyselyPgStateProvider({ db }),
    withNonTransactionContext: async (fn) => fn({ db }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", import.meta.url);
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("postgresql/state-kysely migrator conformance", () => {
  let pg: AcquiredPostgres;
  let db: Kysely<Database>;
  const { context, cases } = createPgMigratorConformanceContext({
    createStateProvider: () => createKyselyPgStateProvider({ db }),
  });

  beforeAll(async () => {
    pg = await acquirePostgres("postgres:18", `${import.meta.url}#migrator`);
    const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
    await pg[Symbol.asyncDispose]();
  });

  for (const conformanceCase of cases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
