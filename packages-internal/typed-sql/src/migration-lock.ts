import type { MaybePromise } from "@queuert/helpers/maybe-promise";
import { isPositiveFinite } from "@queuert/helpers/number";
import { sleep } from "@queuert/helpers/sleep";

export type MigrationLockMethods =
  | {
      acquireMigrationLock: (ownerId: string, ttlMs: number) => Promise<boolean>;
      extendMigrationLock: (ownerId: string, ttlMs: number) => Promise<boolean>;
      releaseMigrationLock: (ownerId: string) => Promise<void>;
    }
  | {
      acquireMigrationLock?: never;
      extendMigrationLock?: never;
      releaseMigrationLock?: never;
    };

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

export type MigrationLease = {
  assertLockHeld: () => void;
  renewLeaseIfStale: () => MaybePromise<void>;
};

const withMigrationLock = async <T>(
  store: MigrationLockMethods,
  { ttlMs, heartbeatIntervalMs, pollIntervalMs }: Required<MigrationLockOptions>,
  fn: (lease: MigrationLease) => MaybePromise<T>,
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

export const runMigrationsLocked = async <T>(
  store: MigrationLockMethods,
  lock: MigrationLockOptions | undefined,
  fn: (lease: MigrationLease) => MaybePromise<T>,
): Promise<T> => withMigrationLock(store, resolveMigrationLockOptions(lock), fn);
