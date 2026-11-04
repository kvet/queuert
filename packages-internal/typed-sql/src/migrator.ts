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
  initialize?: () => Promise<void>;
  runInTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  getAppliedMigrationNames: (txCtx: TTxContext | undefined) => Promise<string[]>;
  executeMigrationStatement: (
    txCtx: TTxContext | undefined,
    statement: TypedSqlTemplate,
  ) => Promise<void>;
  executeBatchMigrationStatement: (
    txCtx: TTxContext | undefined,
    statement: TypedSqlTemplate,
  ) => Promise<number>;
  recordMigration: (txCtx: TTxContext | undefined, name: string) => Promise<void>;
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

export type MigrationScript = (assertLockHeld: () => void) => Promise<void>;

export type Migrator = {
  migrateToLatest: () => Promise<MigrationResult>;
  migrateTo: (targetName: string) => Promise<MigrationResult>;
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
  let lastExtendedAt = performance.now();
  while (!(await acquireMigrationLock(ownerId, ttlMs))) {
    await sleep(pollIntervalMs);
    lastExtendedAt = performance.now();
  }

  let lockLost = false;
  let inFlightTick: Promise<void> | undefined;
  const extend = async (): Promise<void> => {
    const sentAt = performance.now();
    const extended = await extendMigrationLock(ownerId, ttlMs).catch(() => undefined);
    if (extended === true) {
      lastExtendedAt = sentAt;
    } else if (extended === false) {
      lockLost = true;
      clearInterval(heartbeat);
    }
  };
  const heartbeat = setInterval(() => {
    if (lockLost || inFlightTick) return;
    inFlightTick = extend().finally(() => {
      inFlightTick = undefined;
    });
  }, heartbeatIntervalMs);

  try {
    return await fn(() => {
      if (lockLost) {
        throw new Error(
          "Migration lock lost: the lease is no longer held by this run, so another process may have migrated. Aborting to avoid concurrent migration runs.",
        );
      }
      if (performance.now() - lastExtendedAt > ttlMs - heartbeatIntervalMs) {
        throw new Error(
          "Migration lock lost: the lease could not be extended in time. Aborting to avoid concurrent migration runs.",
        );
      }
    });
  } finally {
    clearInterval(heartbeat);
    await inFlightTick;
    await releaseMigrationLock(ownerId).catch(() => {});
  }
};

export const createMigrator = <TTxContext>({
  migrations,
  store,
  lock,
  before,
  after,
}: {
  migrations: Migration[];
  store: MigrationStore<TTxContext>;
  lock?: MigrationLockOptions;
  before?: MigrationScript;
  after?: MigrationScript;
}): Migrator => {
  validateMigrations(migrations);
  const knownNames = new Set(migrations.map((m) => m.name));
  const lockOptions: Required<MigrationLockOptions> = {
    ttlMs: lock?.ttlMs ?? 60_000,
    heartbeatIntervalMs: lock?.heartbeatIntervalMs ?? 20_000,
    pollIntervalMs: lock?.pollIntervalMs ?? 1_000,
  };

  const runMigration = async (
    migration: Migration,
    assertLockHeld: () => void,
  ): Promise<"applied" | "skipped"> => {
    assertLockHeld();
    switch (migration.type) {
      case "transactional":
        return store.runInTransaction(async (txCtx) => {
          if ((await store.getAppliedMigrationNames(txCtx)).includes(migration.name)) {
            return "skipped";
          }
          for (const statement of migration.statements) {
            await store.executeMigrationStatement(txCtx, statement);
          }
          await store.recordMigration(txCtx, migration.name);
          return "applied";
        });
      case "non-transactional":
        for (const statement of migration.statements) {
          assertLockHeld();
          await store.executeMigrationStatement(undefined, statement);
        }
        await store.recordMigration(undefined, migration.name);
        return "applied";
      case "batched":
        for (const statement of migration.statements) {
          let affected: number;
          do {
            assertLockHeld();
            affected = await store.executeBatchMigrationStatement(undefined, statement);
          } while (affected > 0);
        }
        await store.recordMigration(undefined, migration.name);
        return "applied";
    }
  };

  const run = async (selected: Migration[]): Promise<MigrationResult> => {
    await store.initialize?.();
    return withMigrationLock(store, lockOptions, async (assertLockHeld) => {
      if (before) {
        assertLockHeld();
        await before(assertLockHeld);
      }

      const previouslyApplied = await store.runInTransaction(store.getAppliedMigrationNames);
      const previouslyAppliedSet = new Set(previouslyApplied);

      const skipped = previouslyApplied.filter((name) => knownNames.has(name));
      const unrecognized = previouslyApplied.filter((name) => !knownNames.has(name));
      const pending = selected.filter((m) => !previouslyAppliedSet.has(m.name));
      const applied: string[] = [];

      for (const migration of pending) {
        const outcome = await runMigration(migration, assertLockHeld);
        (outcome === "applied" ? applied : skipped).push(migration.name);
      }

      if (after) {
        assertLockHeld();
        await after(assertLockHeld);
      }

      return { skipped, applied, unrecognized };
    });
  };

  return {
    migrateToLatest: async () => run(migrations),
    migrateTo: async (targetName) => run(migrations.filter((m) => m.name <= targetName)),
  };
};
