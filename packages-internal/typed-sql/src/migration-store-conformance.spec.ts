import { DatabaseSync } from "node:sqlite";

import type { MaybePromise, Mode } from "@queuert/helpers/maybe-promise";
import { modal } from "@queuert/helpers/modal";
import { step } from "@queuert/helpers/steps";
import { afterAll, describe, it } from "vitest";

import {
  type MigratorConformanceContext,
  type SyncMigratorConformanceContext,
  migrationStoreBaseGroups,
  migrationStoreTransactionalDdlGroups,
  syncMigrationStoreBaseGroups,
  syncMigrationStoreTransactionalDdlGroups,
} from "./migration-store-conformance.ts";
import type { MigrationStore } from "./migrator.ts";

const db = new DatabaseSync(":memory:");
afterAll(() => {
  db.close();
});

const transaction = modal(function* (fn: (txCtx: { tx: true }) => MaybePromise<unknown>) {
  db.exec("BEGIN");
  try {
    const result = yield* step(fn({ tx: true }));
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

const createStore = (
  sync: boolean,
  migrationTableName: string,
): MigrationStore<{ tx: true }, Mode> => {
  const settle = <T>(fn: () => T): MaybePromise<T> => (sync ? fn() : (async () => fn())());
  return {
    initialize: () =>
      settle(() => {
        db.exec(`CREATE TABLE IF NOT EXISTS ${migrationTableName} (name TEXT PRIMARY KEY)`);
      }),
    runInTransaction: <T>(fn: (txCtx: { tx: true }) => MaybePromise<T>) =>
      (sync ? transaction.sync(fn) : transaction.async(fn)) as MaybePromise<T>,
    getAppliedMigrationNames: () =>
      settle(() =>
        db
          .prepare(`SELECT name FROM ${migrationTableName}`)
          .all()
          .map((row) => String(row.name)),
      ),
    recordMigration: (_txCtx, name) =>
      settle(() => {
        db.prepare(`INSERT OR IGNORE INTO ${migrationTableName} (name) VALUES (?)`).run(name);
      }),
    unrecordMigration: (_txCtx, name) =>
      settle(() => {
        db.prepare(`DELETE FROM ${migrationTableName} WHERE name = ?`).run(name);
      }),
  };
};

const countRows = (table: string): number =>
  Number(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count);

const syncContext: SyncMigratorConformanceContext = {
  createMigrationStore: ({ migrationTableName }) =>
    createStore(true, migrationTableName) as MigrationStore<{ tx: true }, "sync">,
  executeSql: (sql) => {
    db.exec(sql);
  },
  countRows,
};

const asyncContext: MigratorConformanceContext = {
  createMigrationStore: ({ migrationTableName }) =>
    createStore(false, migrationTableName) as MigrationStore<{ tx: true }>,
  executeSql: async (sql) => {
    db.exec(sql);
  },
  countRows: async (table) => countRows(table),
};

describe("migration store conformance in async mode", () => {
  for (const group of [...migrationStoreBaseGroups, ...migrationStoreTransactionalDdlGroups]) {
    describe(group.name, () => {
      for (const conformanceCase of group.cases) {
        it(conformanceCase.name, async () => conformanceCase.run(asyncContext));
      }
    });
  }
});

describe("migration store conformance in sync mode", () => {
  for (const group of [
    ...syncMigrationStoreBaseGroups,
    ...syncMigrationStoreTransactionalDdlGroups,
  ]) {
    describe(group.name, () => {
      for (const conformanceCase of group.cases) {
        it(conformanceCase.name, () => {
          conformanceCase.run(syncContext);
        });
      }
    });
  }
});
