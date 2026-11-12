import { isPositiveFinite } from "@queuert/helpers/number";
import { sleep } from "@queuert/helpers/sleep";

/**
 * A free-form migration script: the `up` and `down` of a `non-transactional` migration, and the
 * migrator's `before` and `after` scripts. It runs outside a transaction and brings its
 * own database access. Call `assertLockHeld` between steps of long work; it throws once the
 * migration lease is lost, so the script stops before another process starts migrating.
 *
 * @experimental
 */
export type MigrationScript = (context: { assertLockHeld: () => void }) => Promise<void>;

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
 * @experimental
 */
export type Migration<TTxContext> = {
  name: string;
} & (
  | {
      type?: "transactional";
      up: (txCtx: TTxContext) => Promise<void>;
      down: (txCtx: TTxContext) => Promise<void>;
    }
  | { type: "non-transactional"; up: MigrationScript; down: MigrationScript }
);

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

export type MigrationStore<TTxContext> = {
  initialize?: () => Promise<void>;
  runInTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  getAppliedMigrationNames: (txCtx: TTxContext | undefined) => Promise<string[]>;
  recordMigration: (txCtx: TTxContext | undefined, name: string) => Promise<void>;
  unrecordMigration: (txCtx: TTxContext | undefined, name: string) => Promise<void>;
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
  /** How often the lease is extended while migrating. @defaultValue the lower of 15s and a quarter of `ttlMs` */
  heartbeatIntervalMs?: number;
  /** How often a waiting process re-attempts to claim the lease. @defaultValue 1s */
  pollIntervalMs?: number;
};

export const resolveMigrationLockOptions = (
  lock: MigrationLockOptions | undefined,
): Required<MigrationLockOptions> => {
  const ttlMs = lock?.ttlMs ?? 60_000;
  return {
    ttlMs,
    heartbeatIntervalMs:
      lock?.heartbeatIntervalMs ?? (isPositiveFinite(ttlMs) ? Math.min(15_000, ttlMs / 4) : 15_000),
    pollIntervalMs: lock?.pollIntervalMs ?? 1_000,
  };
};

const MAX_HEARTBEAT_INTERVAL_MS = 2_147_483_647;

export const migrationLockViolations = ({
  ttlMs,
  heartbeatIntervalMs,
  pollIntervalMs,
}: Required<MigrationLockOptions>): string[] => [
  ...Object.entries({ ttlMs, heartbeatIntervalMs, pollIntervalMs })
    .filter(([, value]) => !isPositiveFinite(value))
    .map(
      ([field, value]) => `lock.${field} must be a positive finite number (got ${String(value)})`,
    ),
  ...(heartbeatIntervalMs > MAX_HEARTBEAT_INTERVAL_MS && Number.isFinite(heartbeatIntervalMs)
    ? [
        `lock.heartbeatIntervalMs must be at most ${String(MAX_HEARTBEAT_INTERVAL_MS)} (got ${String(heartbeatIntervalMs)})`,
      ]
    : []),
  ...(isPositiveFinite(ttlMs) &&
  isPositiveFinite(heartbeatIntervalMs) &&
  3 * heartbeatIntervalMs >= ttlMs
    ? [
        `lock.heartbeatIntervalMs must be below a third of lock.ttlMs (got ${String(heartbeatIntervalMs)} and ${String(ttlMs)})`,
      ]
    : []),
];

export const assertMigrationLockOptions = (
  factoryName: string,
  lock: MigrationLockOptions | undefined,
): void => {
  const violations = migrationLockViolations(resolveMigrationLockOptions(lock));
  if (violations.length > 0) {
    throw new TypeError(
      `${factoryName}: invalid configuration:\n${violations.map((violation) => `  - ${violation}`).join("\n")}`,
    );
  }
};

/**
 * Runs migrations, from `createPgMigrator` or `createSqliteMigrator`. Each call takes the
 * migration lease first, so many processes can migrate on boot at once: one migrates, the others
 * wait for it and then find nothing left to do.
 *
 * @experimental
 */
export type Migrator = {
  /**
   * Apply every pending migration, in list order. Applied migrations the code doesn't know are
   * reported in `unrecognized` and don't stop the run, so an older release keeps booting against a
   * database a newer one migrated.
   *
   * @throws Error if a pending migration is listed before an applied one, or if a migration
   * fails, naming it, with the original error as `cause`.
   */
  migrateToLatest: () => Promise<MigrationResult>;
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
  migrateTo: (name: string | null) => Promise<MigrationResult>;
};

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

const withMigrationName = async <T>(
  action: string,
  migration: { name: string },
  run: Promise<T>,
): Promise<T> => {
  try {
    return await run;
  } catch (error) {
    throw new Error(
      `${action} "${migration.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
};

const withMigrationLock = async <T>(
  store: Pick<
    MigrationStore<unknown>,
    "acquireMigrationLock" | "extendMigrationLock" | "releaseMigrationLock"
  >,
  { ttlMs, heartbeatIntervalMs, pollIntervalMs }: Required<MigrationLockOptions>,
  fn: (lease: { assertLockHeld: () => void; renewLeaseIfStale: () => Promise<void> }) => Promise<T>,
): Promise<T> => {
  const { acquireMigrationLock, extendMigrationLock, releaseMigrationLock } = store;
  if (!acquireMigrationLock || !extendMigrationLock || !releaseMigrationLock) {
    return fn({ assertLockHeld: () => {}, renewLeaseIfStale: async () => {} });
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
  const startExtend = async (): Promise<void> => {
    inFlightTick = extend().finally(() => {
      inFlightTick = undefined;
    });
    return inFlightTick;
  };
  const heartbeat = setInterval(() => {
    if (lockLost || inFlightTick) return;
    void startExtend();
  }, heartbeatIntervalMs);
  const isStale = (): boolean => performance.now() - lastExtendedAt > ttlMs - heartbeatIntervalMs;

  try {
    return await fn({
      renewLeaseIfStale: async () => {
        if (lockLost || !isStale()) return;
        await inFlightTick;
        if (lockLost || !isStale()) return;
        await startExtend();
      },
      assertLockHeld: () => {
        if (lockLost) {
          throw new Error(
            "Migration lock lost: the lease is no longer held by this run, so another process may have migrated. Aborting to avoid concurrent migration runs.",
          );
        }
        if (isStale()) {
          throw new Error(
            "Migration lock lost: the lease could not be extended in time. Aborting to avoid concurrent migration runs.",
          );
        }
      },
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
  migrations: NoInfer<Migration<TTxContext>>[];
  store: MigrationStore<TTxContext>;
  lock?: MigrationLockOptions;
  before?: MigrationScript;
  after?: MigrationScript;
}): Migrator => {
  validateMigrations(migrations);
  const knownNames = new Set(migrations.map((m) => m.name));
  const lockOptions = resolveMigrationLockOptions(lock);

  const runMigration = async (
    migration: Migration<TTxContext>,
    direction: "up" | "down",
    { assertLockHeld, checkLease }: { assertLockHeld: () => void; checkLease: () => Promise<void> },
  ): Promise<boolean> => {
    const updateHistory = async (txCtx: TTxContext | undefined): Promise<void> =>
      direction === "up"
        ? store.recordMigration(txCtx, migration.name)
        : store.unrecordMigration(txCtx, migration.name);
    assertLockHeld();
    if (migration.type === "non-transactional") {
      await migration[direction]({ assertLockHeld });
      await checkLease();
      await updateHistory(undefined);
      return true;
    }
    const run = migration[direction];
    return store.runInTransaction(async (txCtx) => {
      const applied = (await store.getAppliedMigrationNames(txCtx)).includes(migration.name);
      if (applied !== (direction === "down")) {
        return false;
      }
      await run(txCtx);
      await updateHistory(txCtx);
      return true;
    });
  };

  const run = async (targetIndex: number): Promise<MigrationResult> => {
    await store.initialize?.();
    return withMigrationLock(store, lockOptions, async ({ assertLockHeld, renewLeaseIfStale }) => {
      const checkLease = async (): Promise<void> => {
        await renewLeaseIfStale();
        assertLockHeld();
      };
      if (before) {
        await checkLease();
        await before({ assertLockHeld });
      }

      const previouslyApplied = new Set(
        await store.runInTransaction(async (txCtx) => store.getAppliedMigrationNames(txCtx)),
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
        await checkLease();
        if (
          await withMigrationName(
            "Migration",
            migration,
            runMigration(migration, "up", { assertLockHeld, checkLease }),
          )
        ) {
          applied.push(migration.name);
        } else {
          skipped.push(migration.name);
        }
      }
      for (const migration of toRevert) {
        await checkLease();
        if (
          await withMigrationName(
            "Reverting migration",
            migration,
            runMigration(migration, "down", { assertLockHeld, checkLease }),
          )
        ) {
          reverted.push(migration.name);
        }
      }

      if (after) {
        await checkLease();
        await after({ assertLockHeld });
      }

      return { skipped, applied, reverted, unrecognized };
    });
  };

  return {
    migrateToLatest: async () => run(migrations.length - 1),
    migrateTo: async (name) => {
      if (name === null) {
        return run(-1);
      }
      const targetIndex = migrations.findIndex((m) => m.name === name);
      if (targetIndex === -1) {
        throw new Error(`Unknown migration "${name}": it is not in the migration list.`);
      }
      return run(targetIndex);
    },
  };
};
