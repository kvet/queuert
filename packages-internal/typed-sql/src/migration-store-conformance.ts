import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { type Migration, type MigrationStore, createMigrator } from "./migrator.ts";

/**
 * What the migration store conformance cases run against. Each case creates its own store over
 * tables with names unique to the case, and drops them when it ends.
 *
 * @experimental
 */
export type MigratorConformanceContext = {
  /** Creates the store under test over the given history and lock tables. */
  createMigrationStore: (tables: {
    migrationTableName: string;
    lockTableName: string;
  }) => MigrationStore<any>;
  /** Runs a statement that returns no rows, inside the transaction when `txCtx` is given. */
  executeSql: (sql: string, txCtx?: unknown) => Promise<void>;
  /** Counts the rows of a table. Rejects when the table doesn't exist. */
  countRows: (table: string) => Promise<number>;
};

type Group<TContext> = {
  name: string;
  cases: { name: string; run: (context: TContext) => Promise<void> }[];
};

const withTables = async (
  context: MigratorConformanceContext,
  fn: (tables: {
    store: MigrationStore<any>;
    createStore: () => MigrationStore<any>;
    item: string;
  }) => Promise<void>,
): Promise<void> => {
  const prefix = `conformance_${randomBytes(4).toString("hex")}`;
  const tables = {
    migrationTableName: `${prefix}_migration`,
    lockTableName: `${prefix}_lock`,
  };
  const item = `${prefix}_item`;
  const createStore = () => context.createMigrationStore(tables);
  try {
    await fn({ store: createStore(), createStore, item });
  } finally {
    for (const table of [item, tables.migrationTableName, tables.lockTableName]) {
      await context.executeSql(`DROP TABLE IF EXISTS ${table}`);
    }
  }
};

const createItems = (
  context: MigratorConformanceContext,
  item: string,
  count: number,
): Migration<any> => ({
  name: "create_items",
  up: async (txCtx) => {
    await context.executeSql(`CREATE TABLE ${item} (id INTEGER PRIMARY KEY)`, txCtx);
    for (let id = 1; id <= count; id++) {
      await context.executeSql(`INSERT INTO ${item} (id) VALUES (${id})`, txCtx);
    }
  },
  down: async (txCtx) => context.executeSql(`DROP TABLE ${item}`, txCtx),
});

const appliedNames = async (store: MigrationStore<any>): Promise<string[]> =>
  (await store.runInTransaction(async (txCtx) => store.getAppliedMigrationNames(txCtx))).toSorted();

export const migrationStoreBaseGroups: Group<MigratorConformanceContext>[] = [
  {
    name: "migrationStore",
    cases: [
      {
        name: "initialize is idempotent and starts with an empty history",
        run: async (context) =>
          withTables(context, async ({ store }) => {
            await store.initialize?.();
            await store.initialize?.();
            assert.deepEqual(await appliedNames(store), []);
          }),
      },
      {
        name: "records, lists and unrecords migrations",
        run: async (context) =>
          withTables(context, async ({ store }) => {
            await store.initialize?.();
            await store.recordMigration(undefined, "create_invoices");
            await store.recordMigration(undefined, "add_invoice_due_date");
            await store.recordMigration(undefined, "create_invoices");
            assert.deepEqual(await appliedNames(store), [
              "add_invoice_due_date",
              "create_invoices",
            ]);

            await store.unrecordMigration(undefined, "create_invoices");
            assert.deepEqual(await appliedNames(store), ["add_invoice_due_date"]);
          }),
      },
      {
        name: "applies a transactional migration and its record in the migration's transaction",
        run: async (context) =>
          withTables(context, async ({ store, item }) => {
            const result = await createMigrator({
              migrations: [createItems(context, item, 2)],
              store,
            }).migrateToLatest();

            assert.deepEqual(result.applied, ["create_items"]);
            assert.equal(await context.countRows(item), 2);
            assert.deepEqual(await appliedNames(store), ["create_items"]);
          }),
      },
      {
        name: "rolls back a failing transactional migration's work and record",
        run: async (context) =>
          withTables(context, async ({ store, item }) => {
            await assert.rejects(
              createMigrator({
                migrations: [
                  {
                    name: "create_items",
                    up: async (txCtx) => {
                      await context.executeSql(
                        `CREATE TABLE ${item} (id INTEGER PRIMARY KEY)`,
                        txCtx,
                      );
                      await context.executeSql(
                        `INSERT INTO ${item}_missing (id) VALUES (1)`,
                        txCtx,
                      );
                    },
                    down: async () => {},
                  },
                ],
                store,
              }).migrateToLatest(),
            );

            await assert.rejects(context.countRows(item));
            assert.deepEqual(await appliedNames(store), []);
          }),
      },
      {
        name: "records a non-transactional migration after its `up` and unrecords it after its `down`",
        run: async (context) =>
          withTables(context, async ({ store, item }) => {
            const migrator = createMigrator({
              migrations: [
                createItems(context, item, 0),
                {
                  name: "seed_items",
                  type: "non-transactional",
                  up: async ({ assertLockHeld }) => {
                    assertLockHeld();
                    await context.executeSql(`INSERT INTO ${item} (id) VALUES (1)`);
                    await context.executeSql(`INSERT INTO ${item} (id) VALUES (2)`);
                  },
                  down: async () => context.executeSql(`DELETE FROM ${item}`),
                },
              ],
              store,
            });

            await migrator.migrateToLatest();
            assert.equal(await context.countRows(item), 2);
            assert.deepEqual(await appliedNames(store), ["create_items", "seed_items"]);

            const result = await migrator.migrateTo("create_items");
            assert.deepEqual(result.reverted, ["seed_items"]);
            assert.equal(await context.countRows(item), 0);
            assert.deepEqual(await appliedNames(store), ["create_items"]);
          }),
      },
      {
        name: "names the failing migration, keeping the driver error as the cause",
        run: async (context) =>
          withTables(context, async ({ store, item }) => {
            let failure: unknown;
            try {
              await createMigrator({
                migrations: [
                  {
                    name: "create_items",
                    up: async (txCtx) =>
                      context.executeSql(`INSERT INTO ${item}_missing (id) VALUES (1)`, txCtx),
                    down: async () => {},
                  },
                ],
                store,
              }).migrateToLatest();
            } catch (error) {
              failure = error;
            }

            assert.ok(failure instanceof Error);
            assert.match(failure.message, /^Migration "create_items" failed: /);
            assert.ok(failure.cause instanceof Error);
            assert.ok(failure.message.endsWith(failure.cause.message));
          }),
      },
    ],
  },
];

const requireLease = (store: MigrationStore<any>) => {
  const { acquireMigrationLock, extendMigrationLock, releaseMigrationLock } = store;
  if (!acquireMigrationLock || !extendMigrationLock || !releaseMigrationLock) {
    throw new Error("The store has no lease methods.");
  }
  return { acquireMigrationLock, extendMigrationLock, releaseMigrationLock };
};

export const migrationStoreLeaseGroups: Group<MigratorConformanceContext>[] = [
  {
    name: "migrationStoreLease",
    cases: [
      {
        name: "lets one owner hold the lease at a time",
        run: async (context) =>
          withTables(context, async ({ store }) => {
            await store.initialize?.();
            const lease = requireLease(store);

            assert.equal(await lease.acquireMigrationLock("first", 60_000), true);
            assert.equal(await lease.acquireMigrationLock("second", 60_000), false);
            assert.equal(await lease.extendMigrationLock("second", 60_000), false);
            await lease.releaseMigrationLock("second");
            assert.equal(await lease.acquireMigrationLock("second", 60_000), false);
            assert.equal(await lease.extendMigrationLock("first", 60_000), true);

            await lease.releaseMigrationLock("first");
            assert.equal(await lease.acquireMigrationLock("second", 60_000), true);
            await lease.releaseMigrationLock("second");
          }),
      },
      {
        name: "lets another owner take an expired lease",
        run: async (context) =>
          withTables(context, async ({ store }) => {
            await store.initialize?.();
            const lease = requireLease(store);

            assert.equal(await lease.acquireMigrationLock("first", 50), true);
            await new Promise((resolve) => setTimeout(resolve, 150));

            assert.equal(await lease.acquireMigrationLock("second", 60_000), true);
            assert.equal(await lease.extendMigrationLock("first", 60_000), false);
            await lease.releaseMigrationLock("second");
          }),
      },
      {
        name: "applies each migration once when two migrators run at once",
        run: async (context) =>
          withTables(context, async ({ createStore, item }) => {
            const migrations: Migration<any>[] = [
              createItems(context, item, 0),
              {
                name: "seed_items",
                type: "non-transactional",
                up: async () => context.executeSql(`INSERT INTO ${item} (id) VALUES (1)`),
                down: async () => context.executeSql(`DELETE FROM ${item}`),
              },
            ];
            const results = await Promise.all(
              [createStore(), createStore()].map(async (store) =>
                createMigrator({
                  migrations,
                  store,
                  lock: { pollIntervalMs: 10 },
                }).migrateToLatest(),
              ),
            );

            assert.equal(await context.countRows(item), 1);
            assert.deepEqual(
              results.map((result) => result.applied.length).toSorted((a, b) => a - b),
              [0, 2],
            );
          }),
      },
    ],
  },
];
