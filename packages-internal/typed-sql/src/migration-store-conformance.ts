import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import type { MaybePromise, Mode } from "@queuert/helpers/maybe-promise";
import { type Modal, modal } from "@queuert/helpers/modal";
import { step } from "@queuert/helpers/steps";

import { type Migration, type MigrationStore, createModeMigrator } from "./migrator.ts";

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

/**
 * Synchronous variant of {@link MigratorConformanceContext}.
 *
 * @experimental
 */
export type SyncMigratorConformanceContext = {
  /** Synchronous variant of {@link MigratorConformanceContext.createMigrationStore}. */
  createMigrationStore: (tables: {
    migrationTableName: string;
    lockTableName: string;
  }) => MigrationStore<any, "sync">;
  /** Synchronous variant of {@link MigratorConformanceContext.executeSql}. */
  executeSql: (sql: string, txCtx?: unknown) => void;
  /** Synchronous variant of {@link MigratorConformanceContext.countRows}. */
  countRows: (table: string) => number;
};

type ModeContext = {
  createMigrationStore(tables: {
    migrationTableName: string;
    lockTableName: string;
  }): MigrationStore<any, Mode>;
  executeSql(sql: string, txCtx?: unknown): MaybePromise<void>;
  countRows(table: string): MaybePromise<number>;
};

type CaseTables = {
  migrationTableName: string;
  lockTableName: string;
  item: string;
  store: MigrationStore<any, Mode>;
  createStore: () => MigrationStore<any, Mode>;
};

type ModeCase = {
  name: string;
  run: Modal<[context: ModeContext, sync: boolean], void>;
};

type Group<TContext, TResult> = {
  name: string;
  cases: { name: string; run: (context: TContext) => TResult }[];
};

const dropTables: Modal<[context: ModeContext, tables: CaseTables], void> = modal(function* (
  context,
  { item, migrationTableName, lockTableName },
) {
  for (const table of [item, migrationTableName, lockTableName]) {
    yield* step(context.executeSql(`DROP TABLE IF EXISTS ${table}`));
  }
});

const tableCase = (
  name: string,
  body: Modal<[context: ModeContext, sync: boolean, tables: CaseTables], void>,
): ModeCase => ({
  name,
  run: modal(function* (context, sync) {
    const prefix = `conformance_${randomBytes(4).toString("hex")}`;
    const names = { migrationTableName: `${prefix}_migration`, lockTableName: `${prefix}_lock` };
    const createStore = () => context.createMigrationStore(names);
    const tables = { ...names, item: `${prefix}_item`, store: createStore(), createStore };
    try {
      yield* body.steps(context, sync, tables);
    } finally {
      yield* dropTables.steps(context, tables);
    }
  }),
});

const toGroups = <TContext, TResult>(
  groups: { name: string; cases: ModeCase[] }[],
  run: (modeCase: ModeCase, context: TContext) => TResult,
): Group<TContext, TResult>[] =>
  groups.map(({ name, cases }) => ({
    name,
    cases: cases.map((modeCase) => ({
      name: modeCase.name,
      run: (context: TContext) => run(modeCase, context),
    })),
  }));

const insertItems: Modal<
  [context: ModeContext, item: string, count: number, txCtx: unknown],
  void
> = modal(function* (context, item, count, txCtx) {
  yield* step(context.executeSql(`CREATE TABLE ${item} (id INTEGER PRIMARY KEY)`, txCtx));
  for (let id = 1; id <= count; id++) {
    yield* step(context.executeSql(`INSERT INTO ${item} (id) VALUES (${id})`, txCtx));
  }
});

const inMode = <TArgs extends unknown[], TResult>(
  body: Modal<TArgs, TResult>,
  sync: boolean,
): ((...args: TArgs) => MaybePromise<TResult>) => (sync ? body.sync : body.async);

const createItems = (
  context: ModeContext,
  sync: boolean,
  item: string,
  count: number,
): Migration<any, Mode> => ({
  name: "create_items",
  up: (txCtx) => inMode(insertItems, sync)(context, item, count, txCtx),
  down: (txCtx) => context.executeSql(`DROP TABLE ${item}`, txCtx),
});

const appliedNames: Modal<[store: MigrationStore<any, Mode>], string[]> = modal(function* (store) {
  const names = yield* step(
    store.runInTransaction((txCtx) => store.getAppliedMigrationNames(txCtx)),
  );
  return names.toSorted();
});

const failingCreateItems: Modal<[context: ModeContext, item: string, txCtx: unknown], void> = modal(
  function* (context, item, txCtx) {
    yield* step(context.executeSql(`CREATE TABLE ${item} (id INTEGER PRIMARY KEY)`, txCtx));
    yield* step(context.executeSql(`INSERT INTO ${item}_missing (id) VALUES (1)`, txCtx));
  },
);

const failingSeedItems: Modal<[context: ModeContext, item: string, txCtx: unknown], void> = modal(
  function* (context, item, txCtx) {
    yield* step(context.executeSql(`INSERT INTO ${item} (id) VALUES (1)`, txCtx));
    yield* step(context.executeSql(`INSERT INTO ${item}_missing (id) VALUES (1)`, txCtx));
  },
);

const seedItems: Modal<[context: ModeContext, item: string, assertLockHeld: () => void], void> =
  modal(function* (context, item, assertLockHeld) {
    assertLockHeld();
    yield* step(context.executeSql(`INSERT INTO ${item} (id) VALUES (1)`));
    yield* step(context.executeSql(`INSERT INTO ${item} (id) VALUES (2)`));
  });

const baseGroups: { name: string; cases: ModeCase[] }[] = [
  {
    name: "migrationStore",
    cases: [
      tableCase(
        "initialize is idempotent and starts with an empty history",
        modal(function* (_context, _sync, { store }) {
          yield* step(store.initialize?.());
          yield* step(store.initialize?.());
          assert.deepEqual(yield* appliedNames.steps(store), []);
        }),
      ),
      tableCase(
        "records, lists and unrecords migrations",
        modal(function* (_context, _sync, { store }) {
          yield* step(store.initialize?.());
          yield* step(store.recordMigration(undefined, "create_invoices"));
          yield* step(store.recordMigration(undefined, "add_invoice_due_date"));
          yield* step(store.recordMigration(undefined, "create_invoices"));
          assert.deepEqual(yield* appliedNames.steps(store), [
            "add_invoice_due_date",
            "create_invoices",
          ]);

          yield* step(store.unrecordMigration(undefined, "create_invoices"));
          assert.deepEqual(yield* appliedNames.steps(store), ["add_invoice_due_date"]);
        }),
      ),
      tableCase(
        "applies a transactional migration and its record in the migration's transaction",
        modal(function* (context, sync, { store, item }) {
          const result = yield* step(
            createModeMigrator({
              sync,
              migrations: [createItems(context, sync, item, 2)],
              store,
            }).migrateToLatest(),
          );

          assert.deepEqual(result.applied, ["create_items"]);
          assert.equal(yield* step(context.countRows(item)), 2);
          assert.deepEqual(yield* appliedNames.steps(store), ["create_items"]);
        }),
      ),
      tableCase(
        "rolls back a failing transactional migration's row writes and record",
        modal(function* (context, sync, { store, item }) {
          yield* step(context.executeSql(`CREATE TABLE ${item} (id INTEGER PRIMARY KEY)`));
          yield* step(
            assertRejects(() =>
              createModeMigrator({
                sync,
                migrations: [
                  {
                    name: "seed_items",
                    up: (txCtx) => inMode(failingSeedItems, sync)(context, item, txCtx),
                    down: () => {},
                  },
                ],
                store,
              }).migrateToLatest(),
            ),
          );

          assert.equal(yield* step(context.countRows(item)), 0);
          assert.deepEqual(yield* appliedNames.steps(store), []);
        }),
      ),
      tableCase(
        "records a non-transactional migration after its `up` and unrecords it after its `down`",
        modal(function* (context, sync, { store, item }) {
          const migrator = createModeMigrator({
            sync,
            migrations: [
              createItems(context, sync, item, 0),
              {
                name: "seed_items",
                type: "non-transactional",
                up: ({ assertLockHeld }) => inMode(seedItems, sync)(context, item, assertLockHeld),
                down: () => context.executeSql(`DELETE FROM ${item}`),
              },
            ],
            store,
          });

          yield* step(migrator.migrateToLatest());
          assert.equal(yield* step(context.countRows(item)), 2);
          assert.deepEqual(yield* appliedNames.steps(store), ["create_items", "seed_items"]);

          const result = yield* step(migrator.migrateTo("create_items"));
          assert.deepEqual(result.reverted, ["seed_items"]);
          assert.equal(yield* step(context.countRows(item)), 0);
          assert.deepEqual(yield* appliedNames.steps(store), ["create_items"]);
        }),
      ),
      tableCase(
        "names the failing migration, keeping the driver error as the cause",
        modal(function* (context, sync, { store, item }) {
          let failure: unknown;
          try {
            yield* step(
              createModeMigrator({
                sync,
                migrations: [
                  {
                    name: "create_items",
                    up: (txCtx) =>
                      context.executeSql(`INSERT INTO ${item}_missing (id) VALUES (1)`, txCtx),
                    down: () => {},
                  },
                ],
                store,
              }).migrateToLatest(),
            );
          } catch (error) {
            failure = error;
          }

          assert.ok(failure instanceof Error);
          assert.match(failure.message, /^Migration "create_items" failed: /);
          assert.ok(failure.cause instanceof Error);
          assert.ok(failure.message.endsWith(failure.cause.message));
        }),
      ),
    ],
  },
];

const transactionalDdlGroups: { name: string; cases: ModeCase[] }[] = [
  {
    name: "migrationStoreTransactionalDdl",
    cases: [
      tableCase(
        "rolls back a failing transactional migration's work and record",
        modal(function* (context, sync, { store, item }) {
          yield* step(
            assertRejects(() =>
              createModeMigrator({
                sync,
                migrations: [
                  {
                    name: "create_items",
                    up: (txCtx) => inMode(failingCreateItems, sync)(context, item, txCtx),
                    down: () => {},
                  },
                ],
                store,
              }).migrateToLatest(),
            ),
          );

          yield* step(assertRejects(() => context.countRows(item)));
          assert.deepEqual(yield* appliedNames.steps(store), []);
        }),
      ),
    ],
  },
];

const requireLease = (store: MigrationStore<any, Mode>) => {
  const { acquireMigrationLock, extendMigrationLock, releaseMigrationLock } = store;
  if (!acquireMigrationLock || !extendMigrationLock || !releaseMigrationLock) {
    throw new Error("The store has no lease methods.");
  }
  return { acquireMigrationLock, extendMigrationLock, releaseMigrationLock };
};

const leaseGroups: { name: string; cases: ModeCase[] }[] = [
  {
    name: "migrationStoreLease",
    cases: [
      tableCase(
        "lets one owner hold the lease at a time",
        modal(function* (_context, _sync, { store }) {
          yield* step(store.initialize?.());
          const lease = requireLease(store);

          assert.equal(yield* step(lease.acquireMigrationLock("first", 60_000)), true);
          assert.equal(yield* step(lease.acquireMigrationLock("second", 60_000)), false);
          assert.equal(yield* step(lease.extendMigrationLock("second", 60_000)), false);
          yield* step(lease.releaseMigrationLock("second"));
          assert.equal(yield* step(lease.acquireMigrationLock("second", 60_000)), false);
          assert.equal(yield* step(lease.extendMigrationLock("first", 60_000)), true);

          yield* step(lease.releaseMigrationLock("first"));
          assert.equal(yield* step(lease.acquireMigrationLock("second", 60_000)), true);
          yield* step(lease.releaseMigrationLock("second"));
        }),
      ),
      tableCase(
        "lets another owner take an expired lease",
        modal(function* (_context, _sync, { store }) {
          yield* step(store.initialize?.());
          const lease = requireLease(store);

          assert.equal(yield* step(lease.acquireMigrationLock("first", 50)), true);
          yield* step(new Promise((resolve) => setTimeout(resolve, 150)));

          assert.equal(yield* step(lease.acquireMigrationLock("second", 60_000)), true);
          assert.equal(yield* step(lease.extendMigrationLock("first", 60_000)), false);
          yield* step(lease.releaseMigrationLock("second"));
        }),
      ),
      tableCase(
        "applies each migration once when two migrators run at once",
        modal(function* (context, sync, { createStore, item }) {
          const migrations: Migration<any, Mode>[] = [
            createItems(context, sync, item, 0),
            {
              name: "seed_items",
              type: "non-transactional",
              up: () => context.executeSql(`INSERT INTO ${item} (id) VALUES (1)`),
              down: () => context.executeSql(`DELETE FROM ${item}`),
            },
          ];
          const results = yield* step(
            Promise.all(
              [createStore(), createStore()].map(async (store) =>
                createModeMigrator({
                  sync,
                  migrations,
                  store,
                  lock: { pollIntervalMs: 10 },
                }).migrateToLatest(),
              ),
            ),
          );

          assert.equal(yield* step(context.countRows(item)), 1);
          assert.deepEqual(
            results.map((result) => result.applied.length).toSorted((a, b) => a - b),
            [0, 2],
          );
        }),
      ),
    ],
  },
];

const asyncGroups = (
  groups: { name: string; cases: ModeCase[] }[],
): Group<MigratorConformanceContext, Promise<void>>[] =>
  toGroups(groups, async (modeCase, context: MigratorConformanceContext) =>
    modeCase.run.async(context, false),
  );

export const migrationStoreBaseGroups: Group<MigratorConformanceContext, Promise<void>>[] =
  asyncGroups(baseGroups);

export const syncMigrationStoreBaseGroups: Group<SyncMigratorConformanceContext, void>[] = toGroups(
  baseGroups,
  (modeCase, context: SyncMigratorConformanceContext) => {
    modeCase.run.sync(context, true);
  },
);

/**
 * Cases for stores whose transactions roll back DDL, which PostgreSQL and SQLite do and MySQL and
 * MariaDB, where DDL commits implicitly, do not.
 *
 * @experimental
 */
export const migrationStoreTransactionalDdlGroups: Group<
  MigratorConformanceContext,
  Promise<void>
>[] = asyncGroups(transactionalDdlGroups);

/**
 * Synchronous variant of {@link migrationStoreTransactionalDdlGroups}.
 *
 * @experimental
 */
export const syncMigrationStoreTransactionalDdlGroups: Group<
  SyncMigratorConformanceContext,
  void
>[] = toGroups(transactionalDdlGroups, (modeCase, context: SyncMigratorConformanceContext) => {
  modeCase.run.sync(context, true);
});

export const migrationStoreLeaseGroups: Group<MigratorConformanceContext, Promise<void>>[] =
  asyncGroups(leaseGroups);
