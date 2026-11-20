import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { raceWithSleep, sleep } from "@queuert/helpers/sleep";
import {
  dynamicSyncAsync,
  type Mode,
  type ModeResult,
  resource,
  step,
  syncAsync,
  wait,
} from "@queuert/sync-async";

import { type MigrationStore, createMigrator } from "./migrator.ts";

/**
 * What the migration store conformance cases run against. Each case creates its own store over
 * tables with names unique to the case, and drops them when it ends.
 *
 * @typeParam TMode - Whether the members return promises or plain values
 * @experimental
 */
export type MigratorConformanceContext<TMode extends Mode = "async"> = {
  /**
   * Creates the store under test over the given history and lock tables. In the `"sync"` mode the store sets `sync: true` and its members return
   * their results directly.
   */
  createMigrationStore: (tables: {
    migrationTableName: string;
    lockTableName: string;
  }) => MigrationStore<any, TMode> &
    ([TMode] extends ["sync"]
      ? {
          /** Marks the store as synchronous. */
          readonly sync: true;
        }
      : [TMode] extends ["async"]
        ? unknown
        : {
            /** Present on a synchronous store. */
            readonly sync?: true;
          });
  /** Runs a statement that returns no rows, inside the transaction when `txCtx` is given. */
  executeSql: (sql: string, txCtx?: unknown) => ModeResult<TMode, void>;
  /** Counts the rows of a table. Fails when the table doesn't exist. */
  countRows: (table: string) => ModeResult<TMode, number>;
};

export type MigratorConformanceGroup = {
  name: string;
  cases: {
    name: string;
    run: (context: MigratorConformanceContext<Mode>) => Promise<void>;
  }[];
};

export const migrationStoreBaseGroups: MigratorConformanceGroup[] = [
  {
    name: "migrationStore",
    cases: [
      {
        name: "initialize is idempotent and starts with an empty history",
        run: dynamicSyncAsync(function* (context: MigratorConformanceContext<Mode>) {
          const prefix = `conformance_${randomBytes(4).toString("hex")}`;
          const store = yield* resource({
            ...context.createMigrationStore({
              migrationTableName: `${prefix}_migration`,
              lockTableName: `${prefix}_lock`,
            }),
            [Symbol.asyncDispose]: async () => {
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_migration`);
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_lock`);
            },
          });
          yield* step(store.initialize?.());
          yield* step(store.initialize?.());
          const names = yield* step(
            store.runInTransaction((txCtx) => store.getAppliedMigrationNames(txCtx)),
          );
          assert.deepEqual(names.toSorted(), []);
        }),
      },
      {
        name: "records, lists and unrecords migrations",
        run: dynamicSyncAsync(function* (context: MigratorConformanceContext<Mode>) {
          const prefix = `conformance_${randomBytes(4).toString("hex")}`;
          const store = yield* resource({
            ...context.createMigrationStore({
              migrationTableName: `${prefix}_migration`,
              lockTableName: `${prefix}_lock`,
            }),
            [Symbol.asyncDispose]: async () => {
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_migration`);
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_lock`);
            },
          });
          yield* step(store.initialize?.());
          yield* step(store.recordMigration(undefined, "create_invoices"));
          yield* step(store.recordMigration(undefined, "add_invoice_due_date"));
          yield* step(store.recordMigration(undefined, "create_invoices"));
          const recorded = yield* step(
            store.runInTransaction((txCtx) => store.getAppliedMigrationNames(txCtx)),
          );
          assert.deepEqual(recorded.toSorted(), ["add_invoice_due_date", "create_invoices"]);

          yield* step(store.unrecordMigration(undefined, "create_invoices"));
          const remaining = yield* step(
            store.runInTransaction((txCtx) => store.getAppliedMigrationNames(txCtx)),
          );
          assert.deepEqual(remaining.toSorted(), ["add_invoice_due_date"]);
        }),
      },
      {
        name: "applies a transactional migration and its record in the migration's transaction",
        run: dynamicSyncAsync(function* (context: MigratorConformanceContext<Mode>) {
          const prefix = `conformance_${randomBytes(4).toString("hex")}`;
          const item = `${prefix}_item`;
          const createItems = syncAsync(function* (txCtx: unknown) {
            yield* step(context.executeSql(`CREATE TABLE ${item} (id INTEGER PRIMARY KEY)`, txCtx));
            yield* step(context.executeSql(`INSERT INTO ${item} (id) VALUES (1), (2)`, txCtx));
          });
          const store = yield* resource({
            ...context.createMigrationStore({
              migrationTableName: `${prefix}_migration`,
              lockTableName: `${prefix}_lock`,
            }),
            [Symbol.asyncDispose]: async () => {
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_migration`);
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_lock`);
            },
          });
          try {
            const result = yield* step(
              createMigrator({
                mode: store.sync ? "sync" : "async",
                migrations: [
                  {
                    name: "create_items",
                    up: store.sync ? createItems.sync : createItems.async,
                    down: (txCtx) => context.executeSql(`DROP TABLE ${item}`, txCtx),
                  },
                ],
                store,
              }).migrateToLatest(),
            );

            assert.deepEqual(result.applied, ["create_items"]);
            assert.equal(yield* step(context.countRows(item)), 2);
            const names = yield* step(
              store.runInTransaction((txCtx) => store.getAppliedMigrationNames(txCtx)),
            );
            assert.deepEqual(names.toSorted(), ["create_items"]);
          } finally {
            yield* step(context.executeSql(`DROP TABLE IF EXISTS ${item}`));
          }
        }),
      },
      {
        name: "rolls back a failing transactional migration's row writes and record",
        run: dynamicSyncAsync(function* (context: MigratorConformanceContext<Mode>) {
          const prefix = `conformance_${randomBytes(4).toString("hex")}`;
          const item = `${prefix}_item`;
          const seedItems = syncAsync(function* (txCtx: unknown) {
            yield* step(context.executeSql(`INSERT INTO ${item} (id) VALUES (1)`, txCtx));
            yield* step(context.executeSql(`INSERT INTO ${item}_missing (id) VALUES (1)`, txCtx));
          });
          const store = yield* resource({
            ...context.createMigrationStore({
              migrationTableName: `${prefix}_migration`,
              lockTableName: `${prefix}_lock`,
            }),
            [Symbol.asyncDispose]: async () => {
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_migration`);
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_lock`);
            },
          });
          try {
            yield* step(context.executeSql(`CREATE TABLE ${item} (id INTEGER PRIMARY KEY)`));
            yield* step(
              assertRejects(() =>
                createMigrator({
                  mode: store.sync ? "sync" : "async",
                  migrations: [
                    {
                      name: "seed_items",
                      up: store.sync ? seedItems.sync : seedItems.async,
                      down: () => {},
                    },
                  ],
                  store,
                }).migrateToLatest(),
              ),
            );

            assert.equal(yield* step(context.countRows(item)), 0);
            const names = yield* step(
              store.runInTransaction((txCtx) => store.getAppliedMigrationNames(txCtx)),
            );
            assert.deepEqual(names.toSorted(), []);
          } finally {
            yield* step(context.executeSql(`DROP TABLE IF EXISTS ${item}`));
          }
        }),
      },
      {
        name: "records a non-transactional migration after its `up` and unrecords it after its `down`",
        run: dynamicSyncAsync(function* (context: MigratorConformanceContext<Mode>) {
          const prefix = `conformance_${randomBytes(4).toString("hex")}`;
          const item = `${prefix}_item`;
          const store = yield* resource({
            ...context.createMigrationStore({
              migrationTableName: `${prefix}_migration`,
              lockTableName: `${prefix}_lock`,
            }),
            [Symbol.asyncDispose]: async () => {
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_migration`);
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_lock`);
            },
          });
          try {
            const migrator = createMigrator({
              mode: store.sync ? "sync" : "async",
              migrations: [
                {
                  name: "create_items",
                  up: (txCtx) =>
                    context.executeSql(`CREATE TABLE ${item} (id INTEGER PRIMARY KEY)`, txCtx),
                  down: (txCtx) => context.executeSql(`DROP TABLE ${item}`, txCtx),
                },
                {
                  name: "seed_items",
                  type: "non-transactional",
                  up: ({ assertLockHeld }) => {
                    assertLockHeld();
                    return context.executeSql(`INSERT INTO ${item} (id) VALUES (1), (2)`);
                  },
                  down: () => context.executeSql(`DELETE FROM ${item}`),
                },
              ],
              store,
            });

            yield* step(migrator.migrateToLatest());
            assert.equal(yield* step(context.countRows(item)), 2);
            const applied = yield* step(
              store.runInTransaction((txCtx) => store.getAppliedMigrationNames(txCtx)),
            );
            assert.deepEqual(applied.toSorted(), ["create_items", "seed_items"]);

            const result = yield* step(migrator.migrateTo("create_items"));
            assert.deepEqual(result.reverted, ["seed_items"]);
            assert.equal(yield* step(context.countRows(item)), 0);
            const remaining = yield* step(
              store.runInTransaction((txCtx) => store.getAppliedMigrationNames(txCtx)),
            );
            assert.deepEqual(remaining.toSorted(), ["create_items"]);
          } finally {
            yield* step(context.executeSql(`DROP TABLE IF EXISTS ${item}`));
          }
        }),
      },
      {
        name: "names the failing migration, keeping the driver error as the cause",
        run: dynamicSyncAsync(function* (context: MigratorConformanceContext<Mode>) {
          const prefix = `conformance_${randomBytes(4).toString("hex")}`;
          const item = `${prefix}_item`;
          const store = yield* resource({
            ...context.createMigrationStore({
              migrationTableName: `${prefix}_migration`,
              lockTableName: `${prefix}_lock`,
            }),
            [Symbol.asyncDispose]: async () => {
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_migration`);
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_lock`);
            },
          });
          let failure: unknown;
          try {
            yield* step(
              createMigrator({
                mode: store.sync ? "sync" : "async",
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
      },
    ],
  },
];

export const migrationStoreTransactionalDdlGroups: MigratorConformanceGroup[] = [
  {
    name: "migrationStoreTransactionalDdl",
    cases: [
      {
        name: "rolls back a failing transactional migration's work and record",
        run: dynamicSyncAsync(function* (context: MigratorConformanceContext<Mode>) {
          const prefix = `conformance_${randomBytes(4).toString("hex")}`;
          const item = `${prefix}_item`;
          const createItems = syncAsync(function* (txCtx: unknown) {
            yield* step(context.executeSql(`CREATE TABLE ${item} (id INTEGER PRIMARY KEY)`, txCtx));
            yield* step(context.executeSql(`INSERT INTO ${item}_missing (id) VALUES (1)`, txCtx));
          });
          const store = yield* resource({
            ...context.createMigrationStore({
              migrationTableName: `${prefix}_migration`,
              lockTableName: `${prefix}_lock`,
            }),
            [Symbol.asyncDispose]: async () => {
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_migration`);
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_lock`);
            },
          });
          try {
            yield* step(
              assertRejects(() =>
                createMigrator({
                  mode: store.sync ? "sync" : "async",
                  migrations: [
                    {
                      name: "create_items",
                      up: store.sync ? createItems.sync : createItems.async,
                      down: () => {},
                    },
                  ],
                  store,
                }).migrateToLatest(),
              ),
            );

            yield* step(assertRejects(() => context.countRows(item)));
            const names = yield* step(
              store.runInTransaction((txCtx) => store.getAppliedMigrationNames(txCtx)),
            );
            assert.deepEqual(names.toSorted(), []);
          } finally {
            yield* step(context.executeSql(`DROP TABLE IF EXISTS ${item}`));
          }
        }),
      },
    ],
  },
];

export const migrationStoreLeaseGroups: MigratorConformanceGroup[] = [
  {
    name: "migrationStoreLease",
    cases: [
      {
        name: "lets one owner hold the lease at a time",
        run: dynamicSyncAsync(function* (context: MigratorConformanceContext<Mode>) {
          const prefix = `conformance_${randomBytes(4).toString("hex")}`;
          const store = yield* resource({
            ...context.createMigrationStore({
              migrationTableName: `${prefix}_migration`,
              lockTableName: `${prefix}_lock`,
            }),
            [Symbol.asyncDispose]: async () => {
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_migration`);
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_lock`);
            },
          });
          if (store.sync) return;

          yield* step(store.initialize?.());
          assert.ok(store.acquireMigrationLock, "The store has no lease methods.");

          assert.equal(yield* step(store.acquireMigrationLock("first", 60_000)), true);
          assert.equal(yield* step(store.acquireMigrationLock("second", 60_000)), false);
          assert.equal(yield* step(store.extendMigrationLock("second", 60_000)), false);
          yield* step(store.releaseMigrationLock("second"));
          assert.equal(yield* step(store.acquireMigrationLock("second", 60_000)), false);
          assert.equal(yield* step(store.extendMigrationLock("first", 60_000)), true);

          yield* step(store.releaseMigrationLock("first"));
          assert.equal(yield* step(store.acquireMigrationLock("second", 60_000)), true);
          yield* step(store.releaseMigrationLock("second"));
        }),
      },
      {
        name: "lets another owner take an expired lease",
        run: dynamicSyncAsync(function* (context: MigratorConformanceContext<Mode>) {
          const prefix = `conformance_${randomBytes(4).toString("hex")}`;
          const store = yield* resource({
            ...context.createMigrationStore({
              migrationTableName: `${prefix}_migration`,
              lockTableName: `${prefix}_lock`,
            }),
            [Symbol.asyncDispose]: async () => {
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_migration`);
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_lock`);
            },
          });
          if (store.sync) return;

          yield* step(store.initialize?.());
          assert.ok(store.acquireMigrationLock, "The store has no lease methods.");

          assert.equal(yield* step(store.acquireMigrationLock("first", 50)), true);
          yield* wait(sleep(150));

          assert.equal(yield* step(store.acquireMigrationLock("second", 60_000)), true);
          assert.equal(yield* step(store.extendMigrationLock("first", 60_000)), false);
          yield* step(store.releaseMigrationLock("second"));
        }),
      },
      {
        name: "applies each migration once when two migrators run at once",
        run: dynamicSyncAsync(function* (context: MigratorConformanceContext<Mode>) {
          const prefix = `conformance_${randomBytes(4).toString("hex")}`;
          const tables = {
            migrationTableName: `${prefix}_migration`,
            lockTableName: `${prefix}_lock`,
          };
          const item = `${prefix}_item`;
          const stores = [
            yield* resource({
              ...context.createMigrationStore(tables),
              [Symbol.asyncDispose]: async () => {
                await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_migration`);
                await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_lock`);
              },
            }),
            yield* resource({
              ...context.createMigrationStore(tables),
              [Symbol.asyncDispose]: async () => {
                await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_migration`);
                await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_lock`);
              },
            }),
          ];
          try {
            if (stores.some((store) => store.sync)) return;
            const results = yield* wait(
              Promise.all(
                stores.map(async (store) =>
                  createMigrator({
                    mode: "async",
                    migrations: [
                      {
                        name: "create_items",
                        up: async (txCtx) =>
                          context.executeSql(
                            `CREATE TABLE ${item} (id INTEGER PRIMARY KEY)`,
                            txCtx,
                          ),
                        down: async (txCtx) => context.executeSql(`DROP TABLE ${item}`, txCtx),
                      },
                      {
                        name: "seed_items",
                        type: "non-transactional",
                        up: async () => context.executeSql(`INSERT INTO ${item} (id) VALUES (1)`),
                        down: async () => context.executeSql(`DELETE FROM ${item}`),
                      },
                    ],
                    store: store as MigrationStore<any>,
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
          } finally {
            yield* step(context.executeSql(`DROP TABLE IF EXISTS ${item}`));
          }
        }),
      },
      {
        name: "makes a migration transaction wait for an open one while the history is empty",
        run: dynamicSyncAsync(function* (context: MigratorConformanceContext<Mode>) {
          const prefix = `conformance_${randomBytes(4).toString("hex")}`;
          const tables = {
            migrationTableName: `${prefix}_migration`,
            lockTableName: `${prefix}_lock`,
          };
          const holder = yield* resource({
            ...context.createMigrationStore(tables),
            [Symbol.asyncDispose]: async () => {
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_migration`);
              await context.executeSql(`DROP TABLE IF EXISTS ${prefix}_lock`);
            },
          });
          if (holder.sync) return;
          const waiter = context.createMigrationStore(tables) as MigrationStore<any>;

          yield* step(holder.initialize?.());
          const opened = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const holderTransaction = (holder as MigrationStore<any>).runInTransaction(
            async (txCtx) => {
              opened.resolve();
              await release.promise;
              await holder.recordMigration(txCtx, "create_items");
            },
          );
          yield* wait(opened.promise);
          const waiterTransaction = waiter.runInTransaction(async (txCtx) =>
            waiter.getAppliedMigrationNames(txCtx),
          );

          try {
            assert.equal(
              yield* wait(
                raceWithSleep(
                  waiterTransaction.then(
                    () => "settled",
                    () => "settled",
                  ),
                  100,
                ),
              ),
              undefined,
            );
          } finally {
            release.resolve();
            yield* wait(holderTransaction);
          }
          assert.deepEqual(yield* wait(waiterTransaction), ["create_items"]);
        }),
      },
    ],
  },
];
