import { createSqliteStateAdapter } from "@queuert/sqlite";
import type Database from "better-sqlite3";
import knexFactory from "knex";
import { runStateAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createKnexSqliteStateProvider } from "./provider.js";

test("state-sqlite-knex provider passes state adapter conformance", async () => {
  await runStateAdapterConformance(async () => {
    const knex = knexFactory({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
      pool: {
        afterCreate: (conn: Database.Database, done: (err: Error | null) => void) => {
          conn.pragma("auto_vacuum = INCREMENTAL");
          conn.pragma("foreign_keys = ON");
          done(null);
        },
      },
    });

    const stateProvider = createKnexSqliteStateProvider({ knex });
    const adapter = await createSqliteStateAdapter({ stateProvider });
    await adapter.migrateToLatest();

    return {
      stateAdapter: adapter,
      reset: async () => adapter.truncate(),
      dispose: async () => {
        await knex.destroy();
      },
    };
  });
}, 30_000);
