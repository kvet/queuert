import { DatabaseSync } from "node:sqlite";

import type { Mode } from "@queuert/sync-async";
import { afterAll, describe, it } from "vitest";

import {
  type MigratorConformanceContext,
  migrationStoreBaseGroups,
  migrationStoreTransactionalDdlGroups,
} from "./migration-store-conformance.ts";

const db = new DatabaseSync(":memory:");
afterAll(() => {
  db.close();
});

const syncContext: MigratorConformanceContext<Mode> = {
  createMigrationStore: ({ migrationTableName }) => ({
    sync: true,
    initialize: () => {
      db.exec(`CREATE TABLE IF NOT EXISTS ${migrationTableName} (name TEXT PRIMARY KEY)`);
    },
    runInTransaction: (fn) => {
      db.exec("BEGIN");
      try {
        const result = fn({ tx: true });
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    getAppliedMigrationNames: () =>
      db
        .prepare(`SELECT name FROM ${migrationTableName}`)
        .all()
        .map((row) => String(row.name)),
    recordMigration: (_txCtx, name) => {
      db.prepare(`INSERT OR IGNORE INTO ${migrationTableName} (name) VALUES (?)`).run(name);
    },
    unrecordMigration: (_txCtx, name) => {
      db.prepare(`DELETE FROM ${migrationTableName} WHERE name = ?`).run(name);
    },
  }),
  executeSql: (sql) => {
    db.exec(sql);
  },
  countRows: (table) => Number(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count),
};

const asyncContext: MigratorConformanceContext = {
  createMigrationStore: ({ migrationTableName }) => ({
    initialize: async () => {
      db.exec(`CREATE TABLE IF NOT EXISTS ${migrationTableName} (name TEXT PRIMARY KEY)`);
    },
    runInTransaction: async (fn) => {
      db.exec("BEGIN");
      try {
        const result = await fn({ tx: true });
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    getAppliedMigrationNames: async () =>
      db
        .prepare(`SELECT name FROM ${migrationTableName}`)
        .all()
        .map((row) => String(row.name)),
    recordMigration: async (_txCtx, name) => {
      db.prepare(`INSERT OR IGNORE INTO ${migrationTableName} (name) VALUES (?)`).run(name);
    },
    unrecordMigration: async (_txCtx, name) => {
      db.prepare(`DELETE FROM ${migrationTableName} WHERE name = ?`).run(name);
    },
  }),
  executeSql: async (sql) => {
    db.exec(sql);
  },
  countRows: async (table) =>
    Number(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count),
};

describe.for([
  ["async", asyncContext],
  ["sync", syncContext],
] as const)("migration store conformance in %s mode", ([, context]) => {
  for (const group of [...migrationStoreBaseGroups, ...migrationStoreTransactionalDdlGroups]) {
    describe(group.name, () => {
      for (const conformanceCase of group.cases) {
        it(conformanceCase.name, async () => conformanceCase.run(context));
      }
    });
  }
});
