import { type Operation, runOperation } from "@queuert/helpers";

import { type TypedSqlTemplate } from "./sql.js";

export type Migration = {
  name: string;
  type: "transactional" | "non-transactional" | "batched";
  statements: TypedSqlTemplate[];
};

/**
 * Result of running `migrateToLatest`, reporting which migrations were skipped (already applied),
 * applied, and unrecognized (present in the database but not in the code).
 */
export type MigrationResult = {
  skipped: string[];
  applied: string[];
  unrecognized: string[];
};

export type MigrationStore<TTxContext> = {
  /**
   * Bootstrap migration infrastructure tables (migration + lock). Called at the start of every
   * run, before the lock is taken, so it must be idempotent.
   */
  initialize?: () => void | Promise<void>;
  /**
   * Runs `fn` in a transaction. When every store method returns synchronously, `fn` does too, so
   * a synchronous transaction can hold it.
   */
  runInTransaction: <T>(fn: (txCtx: TTxContext) => T | Promise<T>) => T | Promise<T>;
  getAppliedMigrationNames: (txCtx: TTxContext | undefined) => string[] | Promise<string[]>;
  executeMigrationStatement: (
    txCtx: TTxContext | undefined,
    statement: TypedSqlTemplate,
  ) => void | Promise<void>;
  executeBatchMigrationStatement: (
    txCtx: TTxContext | undefined,
    statement: TypedSqlTemplate,
  ) => number | Promise<number>;
  recordMigration: (txCtx: TTxContext | undefined, name: string) => void | Promise<void>;
} & (
  | {
      acquireMigrationLock: (ownerId: string, ttlMs: number) => Promise<boolean>;
      extendMigrationLock: (ownerId: string, ttlMs: number) => Promise<boolean>;
      releaseMigrationLock: (ownerId: string) => Promise<void>;
    }
  | {
      acquireMigrationLock?: never;
      extendMigrationLock?: never;
      releaseMigrationLock?: never;
    }
);

export type MigrationLockOptions = {
  /** How long a claimed lease stays valid without a heartbeat. @defaultValue 60s */
  ttlMs?: number;
  /** How often the lease is extended while migrating. @defaultValue 20s */
  heartbeatIntervalMs?: number;
  /** How often a waiting process re-attempts to claim the lease. @defaultValue 1s */
  pollIntervalMs?: number;
};

export type MigrationScript = (assertLockHeld: () => void) => void | Promise<void>;

type MigratorMode = "sync" | "async";

type MigratorResult<TMode extends MigratorMode, T> = TMode extends "sync" ? T : Promise<T>;

export type Migrator<TMode extends MigratorMode = "async"> = {
  migrateToLatest: () => MigratorResult<TMode, MigrationResult>;
  migrateTo: (targetName: string) => MigratorResult<TMode, MigrationResult>;
};

const MIGRATION_NAME_PATTERN = /^\d{3}_[a-z][a-z0-9_]*$/;

const validateMigrations = (migrations: Migration[]): void => {
  for (let i = 0; i < migrations.length; i++) {
    const name = migrations[i].name;
    if (!MIGRATION_NAME_PATTERN.test(name)) {
      throw new Error(
        `Invalid migration name "${name}". Must match /^\\d{3}_[a-z][a-z0-9_]*$/ (e.g. "001_initial_schema").`,
      );
    }
    if (i > 0 && name <= migrations[i - 1].name) {
      throw new Error(
        `Migrations are not in ascending order: "${migrations[i - 1].name}" must sort before "${name}".`,
      );
    }
  }
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const withMigrationLock = async <TTxContext, T>(
  store: MigrationStore<TTxContext>,
  { ttlMs, heartbeatIntervalMs, pollIntervalMs }: Required<MigrationLockOptions>,
  fn: (assertLockHeld: () => void) => Promise<T>,
): Promise<T> => {
  const { acquireMigrationLock, extendMigrationLock, releaseMigrationLock } = store;
  if (!acquireMigrationLock || !extendMigrationLock || !releaseMigrationLock) {
    return fn(() => {});
  }

  const ownerId = crypto.randomUUID();
  while (!(await acquireMigrationLock(ownerId, ttlMs))) {
    await sleep(pollIntervalMs);
  }

  let lockStolen = false;
  let lastExtendedAt = performance.now();
  const heartbeat = setInterval(() => {
    void (async () => {
      try {
        if (await extendMigrationLock(ownerId, ttlMs)) {
          lastExtendedAt = performance.now();
          return;
        }
        // The lease may have expired with no thief (e.g. a stalled heartbeat);
        // re-claiming our own or an expired lease is atomic, so recover.
        if (await acquireMigrationLock(ownerId, ttlMs)) {
          lastExtendedAt = performance.now();
          return;
        }
        lockStolen = true;
      } catch {
        // Transient heartbeat errors are covered by the staleness check below.
      }
    })();
  }, heartbeatIntervalMs);

  try {
    return await fn(() => {
      if (lockStolen) {
        throw new Error(
          "Migration lock lost: another process took over the migration lease. Aborting to avoid concurrent migration runs.",
        );
      }
      if (performance.now() - lastExtendedAt > ttlMs) {
        throw new Error(
          "Migration lock lost: the lease could not be extended within its TTL. Aborting to avoid concurrent migration runs.",
        );
      }
    });
  } finally {
    clearInterval(heartbeat);
    await releaseMigrationLock(ownerId).catch(() => {});
  }
};

/**
 * In sync mode every store method and script must return synchronously, and the store must not
 * take a migration lock: waiting for a lease is inherently asynchronous.
 */
export const createMigrator = <TTxContext, TMode extends MigratorMode = "async">({
  mode = "async" as TMode,
  migrations,
  store,
  lock,
  before,
  after,
}: {
  mode?: TMode;
  migrations: Migration[];
  store: MigrationStore<TTxContext>;
  lock?: MigrationLockOptions;
  before?: MigrationScript;
  after?: MigrationScript;
}): Migrator<TMode> => {
  validateMigrations(migrations);
  if (mode === "sync" && store.acquireMigrationLock) {
    throw new Error("A sync migrator cannot take a migration lock");
  }
  const knownNames = new Set(migrations.map((m) => m.name));
  const lockOptions: Required<MigrationLockOptions> = {
    ttlMs: lock?.ttlMs ?? 60_000,
    heartbeatIntervalMs: lock?.heartbeatIntervalMs ?? 20_000,
    pollIntervalMs: lock?.pollIntervalMs ?? 1_000,
  };

  const runMigration = function* (
    migration: Migration,
    assertLockHeld: () => void,
  ): Operation<void> {
    assertLockHeld();
    switch (migration.type) {
      case "transactional":
        yield store.runInTransaction((txCtx) =>
          runOperation(mode, function* (): Operation<void> {
            for (const statement of migration.statements) {
              yield store.executeMigrationStatement(txCtx, statement);
            }
            yield store.recordMigration(txCtx, migration.name);
          }),
        );
        break;
      case "non-transactional":
        for (const statement of migration.statements) {
          assertLockHeld();
          yield store.executeMigrationStatement(undefined, statement);
        }
        yield store.recordMigration(undefined, migration.name);
        break;
      case "batched":
        for (const statement of migration.statements) {
          let affected: number;
          do {
            assertLockHeld();
            affected = (yield store.executeBatchMigrationStatement(undefined, statement)) as number;
          } while (affected > 0);
        }
        yield store.recordMigration(undefined, migration.name);
        break;
    }
  };

  const migrate = function* (
    selected: Migration[],
    assertLockHeld: () => void,
  ): Operation<MigrationResult> {
    if (before) {
      assertLockHeld();
      yield before(assertLockHeld);
    }

    const previouslyApplied = (yield store.runInTransaction(
      store.getAppliedMigrationNames,
    )) as string[];
    const previouslyAppliedSet = new Set(previouslyApplied);

    const skipped = previouslyApplied.filter((name) => knownNames.has(name));
    const unrecognized = previouslyApplied.filter((name) => !knownNames.has(name));
    const pending = selected.filter((m) => !previouslyAppliedSet.has(m.name));
    const applied: string[] = [];

    for (const migration of pending) {
      yield* runMigration(migration, assertLockHeld);
      applied.push(migration.name);
    }

    if (after) {
      assertLockHeld();
      yield after(assertLockHeld);
    }

    return { skipped, applied, unrecognized };
  };

  const run = (selected: Migration[]): MigratorResult<TMode, MigrationResult> =>
    (mode === "sync"
      ? runOperation("sync", function* (): Operation<MigrationResult> {
          yield store.initialize?.();
          return yield* migrate(selected, () => {});
        })
      : (async () => {
          await store.initialize?.();
          return withMigrationLock(store, lockOptions, async (assertLockHeld) =>
            runOperation("async", () => migrate(selected, assertLockHeld)),
          );
        })()) as MigratorResult<TMode, MigrationResult>;

  return {
    migrateToLatest: () => run(migrations),
    migrateTo: (targetName) => run(migrations.filter((m) => m.name <= targetName)),
  };
};
