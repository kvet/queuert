import { runDeploymentProcess } from "@queuert/helpers/testing";
import { type Migration, createMigrator } from "@queuert/typed-sql";
import Database from "better-sqlite3";

import { createApplicationSqliteMigrationStore } from "../migration-store/migration-store.sqlite.ts";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";

export const DEPLOYED_MIGRATIONS: Migration<BetterSqlite3Context>[] = [
  {
    name: "create_invoices",
    up: async (txCtx) => {
      txCtx.db.exec(
        "CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, status TEXT)",
      );
      txCtx.db.prepare("INSERT INTO invoices (id, customer) VALUES (1, 'customer-1')").run();
    },
    down: async (txCtx) => {
      txCtx.db.exec("DROP TABLE invoices");
    },
  },
  {
    name: "invoices_customer_idx",
    up: async (txCtx) => {
      txCtx.db.exec("CREATE INDEX invoices_customer_idx ON invoices (customer)");
    },
    down: async (txCtx) => {
      txCtx.db.exec("DROP INDEX invoices_customer_idx");
    },
  },
];

export const LEASE_TTL_MS = 2_000;

const recordDeployment = (db: Database.Database): Migration<BetterSqlite3Context> => ({
  name: "record_deployment",
  type: "non-transactional",
  up: async ({ assertLockHeld }) => {
    assertLockHeld();
    db.exec("CREATE TABLE IF NOT EXISTS deployment_runs (pid INTEGER NOT NULL)");
    db.prepare("INSERT INTO deployment_runs (pid) VALUES (?)").run(process.pid);
  },
  down: async () => {
    db.exec("DROP TABLE IF EXISTS deployment_runs");
  },
});

export const DEPLOYMENT_NAMES: string[] = [
  ...DEPLOYED_MIGRATIONS.map((migration) => migration.name),
  "record_deployment",
];

export const NEWER: Migration<BetterSqlite3Context> = {
  name: "create_payments",
  up: async (txCtx) => {
    txCtx.db.exec("CREATE TABLE payments (id INTEGER PRIMARY KEY)");
  },
  down: async (txCtx) => {
    txCtx.db.exec("DROP TABLE payments");
  },
};

if (process.argv[1] === import.meta.filename) {
  const db = new Database(process.argv[2], { timeout: 30_000 });
  const store = createApplicationSqliteMigrationStore({
    stateProvider: createBetterSqlite3Provider({ db }),
  });
  await runDeploymentProcess({
    migrate: async ({ version, pause }) => {
      const recordMigration = store.recordMigration;
      store.recordMigration = async (txCtx, name) => {
        await pause("inside-migration");
        await recordMigration(txCtx, name);
      };
      const migrations = [...DEPLOYED_MIGRATIONS, recordDeployment(db)];
      return createMigrator({
        migrations: version === "newer" ? [...migrations, NEWER] : migrations,
        store,
        lock: { ttlMs: LEASE_TTL_MS, heartbeatIntervalMs: 200, pollIntervalMs: 50 },
        before: async () => pause("before-migrating"),
      }).migrateToLatest();
    },
    close: () => {
      db.close();
    },
  });
}
