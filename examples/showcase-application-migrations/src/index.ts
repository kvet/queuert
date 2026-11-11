/**
 * Application Migrations Showcase
 *
 * Demonstrates running your application's own migrations with the migrator from
 * `@queuert/postgres` (experimental).
 *
 * Scenarios:
 * 1. Migration types: transactional and non-transactional migrations, including a batched backfill
 * 2. Several processes migrating at once: one migrates, the others skip its work
 * 3. An `after` hook: runs under the lease on every run and logs it in a table of its own
 * 4. Reverting: migrateTo reverts the migrations after the target with their `down`, and
 *    migrateTo(null) reverts every applied migration
 */

import assert from "node:assert/strict";

import { type Migration, createPgMigrator } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import {
  type PostgresJsContext,
  createPostgresJsStateProvider,
} from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";

await using pg = await acquirePostgres("postgres:18", import.meta.url);
const sql = postgres(pg.connectionString, { max: 10 });
const stateProvider = createPostgresJsStateProvider({ sql });

const migrations: Migration<PostgresJsContext>[] = [
  {
    name: "create_invoices",
    up: async ({ txSql }) => {
      await txSql`CREATE TABLE invoices (id integer PRIMARY KEY, customer text NOT NULL, status text)`;
      await txSql`INSERT INTO invoices (id, customer) SELECT n, 'customer-' || n FROM generate_series(1, 5) n`;
    },
    down: async ({ txSql }) => {
      await txSql`DROP TABLE invoices`;
    },
  },
  {
    name: "invoices_customer_idx",
    type: "non-transactional",
    up: async () => {
      await sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_customer_idx ON invoices (customer)`;
    },
    down: async () => {
      await sql`DROP INDEX CONCURRENTLY IF EXISTS invoices_customer_idx`;
    },
  },
  {
    name: "backfill_invoice_status",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (;;) {
        assertLockHeld();
        const { count } =
          await sql`UPDATE invoices SET status = 'open' WHERE id IN (SELECT id FROM invoices WHERE status IS NULL LIMIT ${2})`;
        if (count === 0) return;
      }
    },
    down: async () => {
      await sql`UPDATE invoices SET status = NULL`;
    },
  },
  {
    name: "uppercase_customers",
    type: "non-transactional",
    up: async ({ assertLockHeld }) => {
      for (const { id, customer } of await sql`SELECT id, customer FROM invoices ORDER BY id`) {
        assertLockHeld();
        await sql`UPDATE invoices SET customer = ${String(customer).toUpperCase()} WHERE id = ${id}`;
      }
    },
    down: async () => {
      await sql`UPDATE invoices SET customer = lower(customer)`;
    },
  },
];

// Runs under the lease after every run, even one with nothing to do, and records nothing in the
// migration history; its table outlives the migrations. The lease keeps other processes out, so
// the existence check and the CREATE don't race.
const after = async (): Promise<void> => {
  const [{ exists }] = await sql`SELECT to_regclass('migration_runs') IS NOT NULL AS exists`;
  if (!exists) {
    await sql`CREATE TABLE migration_runs (id serial PRIMARY KEY, finished_at timestamptz NOT NULL DEFAULT now())`;
  }
  await sql`INSERT INTO migration_runs DEFAULT VALUES`;
};
const countRuns = async (): Promise<number> => {
  const [{ runs }] = await sql`SELECT count(*)::int AS runs FROM migration_runs`;
  return runs;
};

const migrator = createPgMigrator({ stateProvider, migrations, after });

console.log("\n--- Scenario 1 & 2: several processes migrating at once ---");
const [first, second] = await Promise.all([
  migrator.migrateToLatest(),
  createPgMigrator({ stateProvider, migrations, after }).migrateToLatest(),
]);
const names = migrations.map((migration) => migration.name);
assert.deepEqual(
  [first.applied, second.applied].toSorted((a, b) => a.length - b.length),
  [[], names],
);
console.log("applied by one process:", first.applied.length > 0 ? first.applied : second.applied);
console.log("skipped by the other:", first.applied.length > 0 ? second.skipped : first.skipped);

const invoices = await sql`SELECT id, customer, status FROM invoices ORDER BY id`;
assert.deepEqual(
  invoices.map((invoice) => ({ ...invoice })),
  [1, 2, 3, 4, 5].map((id) => ({ id, customer: `CUSTOMER-${id}`, status: "open" })),
);
console.log("invoices:", invoices.length, "rows, all open, customers uppercased");

console.log("\n--- Scenario 3: the after hook ---");
const runs = await countRuns();
assert.equal(runs, 2);
console.log("migration_runs:", runs, "rows, one per process, including the one with nothing to do");

console.log("\n--- Scenario 4: reverting with migrateTo ---");
const reverted = await migrator.migrateTo("create_invoices");
assert.deepEqual(reverted.reverted, [
  "uppercase_customers",
  "backfill_invoice_status",
  "invoices_customer_idx",
]);
console.log("reverted:", reverted.reverted);

const [row] = await sql`SELECT count(*)::int AS open FROM invoices WHERE status IS NOT NULL`;
assert.equal(row.open, 0);
const indexes = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'invoices'`;
assert.deepEqual(
  indexes.map((index) => index.indexname),
  ["invoices_pkey"],
);
console.log("invoices table is back to its first migration");

const revertedAll = await migrator.migrateTo(null);
assert.deepEqual(revertedAll.reverted, ["create_invoices"]);
console.log("reverted:", revertedAll.reverted);

const [{ table }] = await sql`SELECT to_regclass('invoices')::text AS table`;
assert.equal(table, null);
const allRuns = await countRuns();
assert.equal(allRuns, 4);
console.log("invoices table is gone; migration_runs kept all", allRuns, "runs");

await sql.end();
