import {
  type MaybePromise,
  type Mode,
  type ModeResult,
  requireSync,
} from "@queuert/helpers/maybe-promise";
import { type Modal, modal } from "@queuert/helpers/modal";
import { step } from "@queuert/helpers/steps";

import {
  type MigrationLease,
  type MigrationLockMethods,
  type MigrationLockOptions,
  runMigrationsLocked,
} from "./migration-lock.ts";

/**
 * A free-form migration script: the `up` and `down` of a `non-transactional` migration, and the
 * migrator's `before` and `after` scripts. It runs outside a transaction and brings its
 * own database access. Call `assertLockHeld` between steps of long work; it throws once the
 * migration lease is lost, so the script stops before another process starts migrating.
 *
 * @experimental
 */
export type MigrationScript<TMode extends Mode = "async"> = (context: {
  assertLockHeld: () => void;
}) => ModeResult<TMode, void>;

/**
 * One migration. Migrations run in the order of their list, and `name` identifies a migration in
 * the history table, so it must be unique and must not change once the migration has run.
 *
 * `up` applies the migration and `down` reverts it when `migrateTo` targets an earlier migration.
 * A migration that cannot be reverted throws from its `down`: the revert stops there, and the
 * migration stays recorded.
 *
 * - `transactional` (the default): `up` and `down` receive the migration's transaction context
 *   and run inside that transaction, together with the history change, so your query builder
 *   works on the migration's connection.
 * - `non-transactional`: `up` and `down` run outside a transaction with their own database access
 *   (e.g. `CREATE INDEX CONCURRENTLY`, or a backfill in batches). Call `assertLockHeld` between
 *   steps of long work: it throws once the migration lease is lost. The history changes after the
 *   function resolves, so it must be safe to run again.
 *
 * @typeParam TTxContext - The state provider's transaction context.
 * @typeParam TMode - Whether `up` and `down` return promises or run synchronously.
 * @experimental
 */
export type Migration<TTxContext, TMode extends Mode = "async"> =
  | TransactionalMigration<TTxContext, TMode>
  | {
      name: string;
      type: "non-transactional";
      up: MigrationScript<TMode>;
      down: MigrationScript<TMode>;
    };

type TransactionalMigration<TTxContext, TMode extends Mode> = {
  name: string;
  type?: "transactional";
  up: (txCtx: TTxContext) => ModeResult<TMode, void>;
  down: (txCtx: TTxContext) => ModeResult<TMode, void>;
};

/**
 * Result of a migration run: which migrations were skipped (already applied), applied, reverted,
 * and unrecognized (present in the database but not in the code).
 */
export type MigrationResult = {
  skipped: string[];
  applied: string[];
  reverted: string[];
  unrecognized: string[];
};

/** Where a migrator keeps its history. A synchronous store takes no lease, so it has no lock. */
export type MigrationStore<TTxContext, TMode extends Mode = "async"> = {
  initialize?: () => ModeResult<TMode, void>;
  runInTransaction: <T>(fn: (txCtx: TTxContext) => ModeResult<TMode, T>) => ModeResult<TMode, T>;
  getAppliedMigrationNames: (txCtx: TTxContext | undefined) => ModeResult<TMode, string[]>;
  recordMigration: (txCtx: TTxContext | undefined, name: string) => ModeResult<TMode, void>;
  unrecordMigration: (txCtx: TTxContext | undefined, name: string) => ModeResult<TMode, void>;
} & ([TMode] extends ["sync"] ? unknown : MigrationLockMethods);

/**
 * Runs migrations, from `createPgMigrator` or `createSqliteMigrator`. Each call takes the
 * migration lease first, so many processes can migrate on boot at once: one migrates, the others
 * wait for it and then find nothing left to do. A synchronous migrator (`TMode` `"sync"`) takes no
 * lease and returns its results directly.
 *
 * @typeParam TMode - Whether the methods return promises or plain values.
 * @experimental
 */
export type Migrator<TMode extends Mode = "async"> = {
  /**
   * Apply every pending migration, in list order. Applied migrations the code doesn't know are
   * reported in `unrecognized` and don't stop the run, so an older release keeps booting against a
   * database a newer one migrated.
   *
   * @throws Error if a pending migration is listed before an applied one, or if a migration
   * fails, naming it, with the original error as `cause`.
   */
  migrateToLatest: () => ModeResult<TMode, MigrationResult>;
  /**
   * Bring the database to the migration named `name`: apply the pending migrations up to and
   * including it, or revert the applied migrations after it with their `down`, last first. With
   * `null`, revert every applied migration.
   *
   * @throws Error if `name` is not in the list, if a pending migration is listed before an
   * applied one, or, before reverting anything, if the database has applied migrations the code
   * doesn't know. Also if a migration's `up` or `down` fails, naming it, with the original error
   * as `cause`.
   */
  migrateTo: (name: string | null) => ModeResult<TMode, MigrationResult>;
};

type MigrationRun = {
  sync: boolean;
  migrations: Migration<any, Mode>[];
  knownNames: Set<string>;
  store: MigrationStore<any, Mode>;
  lock: MigrationLockOptions | undefined;
  before: MigrationScript<Mode> | undefined;
  after: MigrationScript<Mode> | undefined;
};

type Direction = "up" | "down";

const validateMigrations = (migrations: { name: string }[]): void => {
  const seen = new Set<string>();
  for (const { name } of migrations) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("Invalid migration name: every migration needs a non-empty name.");
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate migration name "${name}": migration names must be unique.`);
    }
    seen.add(name);
  }
};

const targetIndexOf = (migrations: { name: string }[], name: string | null): number => {
  if (name === null) {
    return -1;
  }
  const targetIndex = migrations.findIndex((m) => m.name === name);
  if (targetIndex === -1) {
    throw new Error(`Unknown migration "${name}": it is not in the migration list.`);
  }
  return targetIndex;
};

const inMode = <TArgs extends unknown[], TResult>(
  body: Modal<TArgs, TResult>,
  sync: boolean,
): ((...args: TArgs) => MaybePromise<TResult>) => (sync ? body.sync : body.async);

const callbackResult = <T>(run: MigrationRun, value: MaybePromise<T>): MaybePromise<T> =>
  run.sync
    ? requireSync(value, "Expected a synchronous callback, but it returned a promise")
    : value;

const updateHistory = (
  run: MigrationRun,
  migration: { name: string },
  direction: Direction,
  txCtx: unknown,
): MaybePromise<void> =>
  direction === "up"
    ? run.store.recordMigration(txCtx, migration.name)
    : run.store.unrecordMigration(txCtx, migration.name);

const checkLease: Modal<[lease: MigrationLease], void> = modal(function* (lease) {
  yield* step(lease.renewLeaseIfStale());
  lease.assertLockHeld();
});

const runTransactionalMigration: Modal<
  [
    run: MigrationRun,
    migration: TransactionalMigration<any, Mode>,
    direction: Direction,
    txCtx: unknown,
  ],
  boolean
> = modal(function* (run, migration, direction, txCtx) {
  const applied = (yield* step(run.store.getAppliedMigrationNames(txCtx))).includes(migration.name);
  if (applied !== (direction === "down")) {
    return false;
  }
  yield* step(callbackResult(run, migration[direction](txCtx)));
  yield* step(updateHistory(run, migration, direction, txCtx));
  return true;
});

const runMigration: Modal<
  [run: MigrationRun, migration: Migration<any, Mode>, direction: Direction, lease: MigrationLease],
  boolean
> = modal(function* (run, migration, direction, lease) {
  try {
    lease.assertLockHeld();
    if (migration.type === "non-transactional") {
      yield* step(
        callbackResult(run, migration[direction]({ assertLockHeld: lease.assertLockHeld })),
      );
      yield* checkLease.steps(lease);
      yield* step(updateHistory(run, migration, direction, undefined));
      return true;
    }
    const runInTransaction = inMode(runTransactionalMigration, run.sync);
    return yield* step(
      run.store.runInTransaction((txCtx) => runInTransaction(run, migration, direction, txCtx)),
    );
  } catch (error) {
    const label =
      direction === "up"
        ? `Migration "${migration.name}"`
        : `Reverting migration "${migration.name}"`;
    throw new Error(`${label} failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
});

const migrate: Modal<
  [run: MigrationRun, targetIndex: number, lease: MigrationLease],
  MigrationResult
> = modal(function* (run, targetIndex, lease) {
  const { migrations, store, knownNames, before, after } = run;
  const { assertLockHeld } = lease;
  if (before) {
    yield* checkLease.steps(lease);
    yield* step(callbackResult(run, before({ assertLockHeld })));
  }

  const previouslyApplied = new Set(
    yield* step(store.runInTransaction((txCtx) => store.getAppliedMigrationNames(txCtx))),
  );
  const unrecognized = [...previouslyApplied].filter((name) => !knownNames.has(name));

  const lastAppliedIndex = migrations.findLastIndex((m) => previouslyApplied.has(m.name));
  const outOfOrder = migrations
    .slice(0, Math.max(lastAppliedIndex, 0))
    .filter((m) => !previouslyApplied.has(m.name));
  if (outOfOrder.length > 0) {
    throw new Error(
      `Pending migrations are listed before the applied migration "${migrations[lastAppliedIndex].name}": ${outOfOrder.map((m) => `"${m.name}"`).join(", ")}. Append new migrations to the end of the list.`,
    );
  }

  const toApply = migrations
    .slice(0, targetIndex + 1)
    .filter((m) => !previouslyApplied.has(m.name));
  const toRevert = migrations
    .slice(targetIndex + 1)
    .filter((m) => previouslyApplied.has(m.name))
    .reverse();

  if (toRevert.length > 0 && unrecognized.length > 0) {
    throw new Error(
      `Cannot revert: the database has applied migrations the code doesn't know: ${unrecognized.map((name) => `"${name}"`).join(", ")}.`,
    );
  }

  const skipped = migrations
    .filter((m) => previouslyApplied.has(m.name) && !toRevert.includes(m))
    .map((m) => m.name);
  const applied: string[] = [];
  const reverted: string[] = [];
  for (const migration of toApply) {
    yield* checkLease.steps(lease);
    if (yield* runMigration.steps(run, migration, "up", lease)) {
      applied.push(migration.name);
    } else {
      skipped.push(migration.name);
    }
  }
  for (const migration of toRevert) {
    yield* checkLease.steps(lease);
    if (yield* runMigration.steps(run, migration, "down", lease)) {
      reverted.push(migration.name);
    }
  }

  if (after) {
    yield* checkLease.steps(lease);
    yield* step(callbackResult(run, after({ assertLockHeld })));
  }

  return { skipped, applied, reverted, unrecognized };
});

const unlockedLease: MigrationLease = {
  assertLockHeld: () => {},
  renewLeaseIfStale: () => {},
};

const migrateToName: Modal<[run: MigrationRun, name: string | null], MigrationResult> = modal(
  function* (run, name) {
    const targetIndex = targetIndexOf(run.migrations, name);
    yield* step(run.store.initialize?.());
    const migrateLeased = inMode(migrate, run.sync);
    return yield* step(
      run.sync
        ? migrateLeased(run, targetIndex, unlockedLease)
        : runMigrationsLocked(run.store, run.lock, (lease) =>
            migrateLeased(run, targetIndex, lease),
          ),
    );
  },
);

export const createModeMigrator = <TTxContext>({
  sync,
  migrations,
  store,
  lock,
  before,
  after,
}: {
  sync: boolean;
  migrations: NoInfer<Migration<TTxContext, Mode>>[];
  store: MigrationStore<TTxContext, Mode>;
  lock?: MigrationLockOptions;
  before?: MigrationScript<Mode>;
  after?: MigrationScript<Mode>;
}): Migrator<Mode> => {
  validateMigrations(migrations);
  const run: MigrationRun = {
    sync,
    migrations,
    knownNames: new Set(migrations.map((m) => m.name)),
    store,
    lock,
    before,
    after,
  };
  const latest = migrations.at(-1)?.name ?? null;
  const toName = inMode(migrateToName, sync);
  return {
    migrateToLatest: () => toName(run, latest),
    migrateTo: (name) => toName(run, name),
  };
};

export const createMigrator = <TTxContext>(options: {
  migrations: NoInfer<Migration<TTxContext>>[];
  store: MigrationStore<TTxContext>;
  lock?: MigrationLockOptions;
  before?: MigrationScript;
  after?: MigrationScript;
}): Migrator => createModeMigrator({ ...options, sync: false }) as Migrator;

export const createSyncMigrator = <TTxContext>(options: {
  migrations: NoInfer<Migration<TTxContext, "sync">>[];
  store: MigrationStore<TTxContext, "sync">;
  before?: MigrationScript<"sync">;
  after?: MigrationScript<"sync">;
}): Migrator<"sync"> => createModeMigrator({ ...options, sync: true }) as Migrator<"sync">;
