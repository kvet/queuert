import { type TypedSqlTemplate } from "./sql.js";

export type Migration = {
  name: string;
  statements: TypedSqlTemplate[];
  type: "transactional" | "non-transactional" | "batched";
};

/** Result of running `migrateToLatest`, reporting which migrations were skipped (already applied), applied, and unrecognized (present in the database but not in the code). */
export type MigrationResult = {
  skipped: string[];
  applied: string[];
  unrecognized: string[];
};

export type MigrationStore<TTxContext> = {
  /** Bootstrap migration infrastructure tables (migration + lock). Called once before any other method. */
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
  /** How long a claimed lease stays valid without a heartbeat. Default: 60s. */
  ttlMs?: number;
  /** How often the lease is extended while migrating. Default: 20s. */
  heartbeatIntervalMs?: number;
  /** How often a waiting process re-attempts to claim the lease. Default: 1s. */
  pollIntervalMs?: number;
};

export type Migrator = {
  migrateToLatest: () => Promise<MigrationResult>;
  migrateTo: (targetName: string) => Promise<MigrationResult>;
};

const MIGRATION_NAME_PATTERN = /^\d{14}_[a-z][a-z0-9_]*$/;

const validateMigrations = (migrations: Migration[]): void => {
  for (let i = 0; i < migrations.length; i++) {
    const name = migrations[i].name;
    if (!MIGRATION_NAME_PATTERN.test(name)) {
      throw new Error(
        `Invalid migration name "${name}". Must match /^\\d{14}_[a-z][a-z0-9_]*$/ (e.g. "20240101000000_initial_schema").`,
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

export const createMigrator = <TTxContext>({
  migrations,
  store,
  lock,
}: {
  migrations: Migration[];
  store: MigrationStore<TTxContext>;
  lock?: MigrationLockOptions;
}): Migrator => {
  validateMigrations(migrations);
  const knownNames = new Set(migrations.map((m) => m.name));
  const lockOptions: Required<MigrationLockOptions> = {
    ttlMs: lock?.ttlMs ?? 60_000,
    heartbeatIntervalMs: lock?.heartbeatIntervalMs ?? 20_000,
    pollIntervalMs: lock?.pollIntervalMs ?? 1_000,
  };

  const runMigration = async (migration: Migration, assertLockHeld: () => void): Promise<void> => {
    assertLockHeld();
    switch (migration.type) {
      case "transactional":
        await store.runInTransaction(async (txCtx) => {
          for (const statement of migration.statements) {
            await store.executeMigrationStatement(txCtx, statement);
          }
          await store.recordMigration(txCtx, migration.name);
        });
        break;
      case "non-transactional":
        for (const statement of migration.statements) {
          assertLockHeld();
          await store.executeMigrationStatement(undefined, statement);
        }
        await store.recordMigration(undefined, migration.name);
        break;
      case "batched":
        for (const statement of migration.statements) {
          let affected: number;
          do {
            assertLockHeld();
            affected = await store.executeBatchMigrationStatement(undefined, statement);
          } while (affected > 0);
        }
        await store.recordMigration(undefined, migration.name);
        break;
    }
  };

  const run = async (selected: Migration[]): Promise<MigrationResult> => {
    await store.initialize?.();
    return withMigrationLock(store, lockOptions, async (assertLockHeld) => {
      const previouslyApplied = await store.runInTransaction(store.getAppliedMigrationNames);
      const previouslyAppliedSet = new Set(previouslyApplied);

      const skipped = previouslyApplied.filter((name) => knownNames.has(name));
      const unrecognized = previouslyApplied.filter((name) => !knownNames.has(name));
      const pending = selected.filter((m) => !previouslyAppliedSet.has(m.name));
      const applied: string[] = [];

      for (const migration of pending) {
        await runMigration(migration, assertLockHeld);
        applied.push(migration.name);
      }

      return { skipped, applied, unrecognized };
    });
  };

  return {
    migrateToLatest: async () => run(migrations),
    migrateTo: async (targetName) => run(migrations.filter((m) => m.name <= targetName)),
  };
};
