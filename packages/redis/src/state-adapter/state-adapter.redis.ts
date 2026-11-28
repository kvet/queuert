import { chunk } from "@queuert/helpers/chunk";
import { createLatch } from "@queuert/helpers/latch";
import type { MigrationResult } from "@queuert/typed-sql";
import {
  type Page,
  type RetryConfig,
  type ScheduleOptions,
  type StateAdapter,
  type StateChain,
  type StateChainInfo,
  type StateChainStatus,
  type StateCount,
  type StateJob,
  type StateJobInfo,
  type StateWorkerInfo,
  createTxHooks,
} from "queuert";
import {
  decodeIdCursor,
  decodeTimestampWithIdCursor,
  encodeCursor,
  resolveStateAdapterConfig,
  retryConfigViolations,
  withRetry,
} from "queuert/internal";

import { RedisTransactionConflictError } from "../errors.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";
import { CLAIM_SCRIPT } from "./claim-script.ts";
import {
  type RedisStore,
  type RedisStoreContext,
  type RedisStoreTransaction,
  type RedisTransaction,
  type ZsetMember,
  compareZsetMembers,
  createRedisTransaction,
  decodeRecord,
  toSchemaFencedError,
} from "./redis-transaction.ts";
import { migrateRedisSchemaToLatest } from "./state-schema.migrations.redis.ts";
import {
  type IndexEntries,
  SCHEMA_VERSION,
  createRedisSchema,
  dueJobId,
  opaqueRecordFields,
} from "./state-schema.redis.ts";

type BlockerEntry = { blockedByChainId: string; index: number; traceContext: string | null };

type DbJob = StateJobInfo & {
  chainStatus: StateChainStatus | null;
  chainCompletedAt: Date | null;
  deduplicationKey: string | null;
  chainTraceContext: string | null;
  seq: string;
  blocking: boolean;
  blockers: BlockerEntry[];
};

export type StoredJob = Omit<
  DbJob,
  "createdAt" | "scheduledAt" | "completedAt" | "lastAttemptAt" | "attemptAt" | "chainCompletedAt"
> & {
  createdAt: number;
  scheduledAt: number;
  completedAt: number | null;
  lastAttemptAt: number | null;
  attemptAt: number | null;
  chainCompletedAt: number | null;
};

type DbWorker = Omit<StateWorkerInfo, "expired">;
export type StoredWorker = Omit<DbWorker, "startedAt" | "leaseUntil"> & {
  startedAt: number;
  leaseUntil: number;
};

const toTime = (date: Date | null): number | null => (date === null ? null : date.getTime());
const toDate = (time: number | null): Date | null => (time === null ? null : new Date(time));

const serializeJob = (job: DbJob): StoredJob => ({
  ...job,
  createdAt: job.createdAt.getTime(),
  scheduledAt: job.scheduledAt.getTime(),
  completedAt: toTime(job.completedAt),
  lastAttemptAt: toTime(job.lastAttemptAt),
  attemptAt: toTime(job.attemptAt),
  chainCompletedAt: toTime(job.chainCompletedAt),
});

const deserializeJob = (stored: StoredJob): DbJob => ({
  ...stored,
  input: stored.input ?? null,
  output: stored.output ?? null,
  chainStatus: stored.chainStatus ?? null,
  continuedToId: stored.continuedToId ?? null,
  completedBy: stored.completedBy ?? null,
  lastAttemptError: stored.lastAttemptError ?? null,
  lastRescheduleReason: stored.lastRescheduleReason ?? null,
  attemptBy: stored.attemptBy ?? null,
  attemptToken: stored.attemptToken ?? null,
  deduplicationKey: stored.deduplicationKey ?? null,
  chainTraceContext: stored.chainTraceContext ?? null,
  traceContext: stored.traceContext ?? null,
  createdAt: new Date(stored.createdAt),
  scheduledAt: new Date(stored.scheduledAt),
  completedAt: toDate(stored.completedAt ?? null),
  lastAttemptAt: toDate(stored.lastAttemptAt ?? null),
  attemptAt: toDate(stored.attemptAt ?? null),
  chainCompletedAt: toDate(stored.chainCompletedAt ?? null),
  blocking: stored.blocking ?? false,
  blockers: Array.isArray(stored.blockers)
    ? stored.blockers.map((blocker) => ({ ...blocker }))
    : [],
});

const serializeWorker = (worker: DbWorker): StoredWorker => ({
  ...worker,
  startedAt: worker.startedAt.getTime(),
  leaseUntil: worker.leaseUntil.getTime(),
});

const deserializeWorker = (stored: StoredWorker): DbWorker => ({
  ...stored,
  typeNames: [...stored.typeNames],
  startedAt: new Date(stored.startedAt),
  leaseUntil: new Date(stored.leaseUntil),
});

const jobInfo = (job: DbJob): StateJobInfo => ({
  id: job.id,
  typeName: job.typeName,
  chainId: job.chainId,
  chainIndex: job.chainIndex,
  status: job.status,
  createdAt: job.createdAt,
  input: job.input,
  scheduledAt: job.scheduledAt,
  completedAt: job.completedAt,
  completedBy: job.completedBy,
  continuedToId: job.continuedToId,
  output: job.output,
  attempt: job.attempt,
  consecutiveFailures: job.consecutiveFailures,
  lastAttemptAt: job.lastAttemptAt,
  lastAttemptError: job.lastAttemptError,
  lastRescheduleReason: job.lastRescheduleReason,
  attemptAt: job.attemptAt,
  attemptBy: job.attemptBy,
  attemptToken: job.attemptToken,
  traceContext: job.traceContext,
});

const chainInfo = (head: DbJob): StateChainInfo => ({
  id: head.id,
  typeName: head.typeName,
  status: head.chainStatus!,
  deduplicationKey: head.deduplicationKey,
  createdAt: head.createdAt,
  completedAt: head.chainCompletedAt,
  traceContext: head.chainTraceContext,
  blocking: head.blocking,
});

const isLive = (worker: DbWorker, nowMs: number): boolean => worker.leaseUntil.getTime() > nowMs;

const workerInfo = (worker: DbWorker, nowMs: number): StateWorkerInfo => ({
  ...worker,
  typeNames: [...worker.typeNames],
  expired: !isLive(worker, nowMs),
});

const holdsAttempt = (job: DbJob, attemptToken: string | undefined): boolean =>
  attemptToken === undefined || (job.status === "running" && job.attemptToken === attemptToken);

const clampToFloor = (requested: Date, now: Date): Date =>
  requested.getTime() > now.getTime() ? requested : now;

const resolveScheduledAt = (schedule: ScheduleOptions | undefined, now: Date): Date =>
  clampToFloor(
    schedule?.at ?? (schedule?.afterMs ? new Date(now.getTime() + schedule.afterMs) : now),
    now,
  );

const assertWellFormed = (subject: string, value: string): void => {
  if (!value.isWellFormed()) {
    throw new Error(`${subject} "${value}" contains a lone surrogate, which Redis scripts reject`);
  }
};

const capCount = (count: number, countCap: number): StateCount => ({
  count: Math.min(count, countCap),
  hasMore: count > countCap,
});

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const takeMembers = async (
  members: AsyncGenerator<ZsetMember>,
  count: number,
): Promise<ZsetMember[]> => {
  const taken: ZsetMember[] = [];
  if (count <= 0) return taken;
  for await (const member of members) {
    taken.push(member);
    if (taken.length >= count) break;
  }
  return taken;
};

const jobLockTtlMs = 60_000;
const claimLockedSlack = 16;
const claimScanCap = 1_000;
const replayTtlMs = 60_000;

const hasHashTag = (keyPrefix: string): boolean => {
  const open = keyPrefix.indexOf("{");
  const close = keyPrefix.indexOf("}", open + 1);
  return open >= 0 && close > open + 1;
};

const scanBatchSize = (limit: number): number => Math.min(Math.max(limit + 1, 16), 500);

const timestampCursorStart = (
  cursor: string | undefined,
  sortKey: string,
): ZsetMember | undefined => {
  if (!cursor) return undefined;
  const { value, id } = decodeTimestampWithIdCursor(cursor, sortKey);
  return { score: Date.parse(value), member: id };
};

const timestampPage = <T>(
  items: T[],
  members: ZsetMember[],
  limit: number,
  sortKey: string,
): Page<T> => {
  const last = members[limit - 1];
  return {
    items: items.slice(0, limit),
    nextCursor:
      members.length > limit && last
        ? encodeCursor({
            type: "timestampWithId",
            sortKey,
            value: new Date(last.score).toISOString(),
            id: last.member,
          })
        : null,
  };
};

let sequenceCounter = 0;
export const nextSeq = (now: Date): string =>
  `${now.getTime().toString(36).padStart(10, "0")}${(sequenceCounter++ % 36 ** 6)
    .toString(36)
    .padStart(6, "0")}`;

const transactionSymbol: unique symbol = Symbol("queuert.redis.transaction");

/**
 * Transaction context of the Redis state adapter: an opaque handle to the optimistic transaction
 * its `withTransaction` opened. Spread it into every client call made in that transaction.
 *
 * @experimental
 */
export type RedisContext = { readonly [transactionSymbol]: RedisTransaction };

/**
 * A state adapter that keeps Queuert's chains, jobs and workers in Redis.
 *
 * @experimental
 */
export type RedisStateAdapter = StateAdapter<RedisContext, string, string, "async"> & {
  /**
   * Bring the adapter's keys to the latest schema version. Run it before the adapter writes:
   * until it has run, every write other than deleting chains and stopping workers fails at commit
   * with `SchemaFencedError`. Processes may run it at once; one migrates and the others wait for
   * it.
   *
   */
  migrateToLatest: () => Promise<MigrationResult>;
};

/**
 * Creates a state adapter that keeps Queuert's state in Redis 6+.
 *
 * Redis has no interactive transactions, so `withTransaction` runs optimistically: reads go to
 * Redis and record the version of every record they see, writes are buffered, and the commit is
 * one Lua script that applies the writes only if nothing read changed in the meantime. On a
 * conflict the adapter runs the callback again, so a transaction callback must be safe to rerun;
 * side effects belong in `onTransactionCommit`. After `transactionRetry.maxTries` conflicting
 * tries it throws {@link RedisTransactionConflictError}.
 *
 * Redis holds only Queuert's state, so writes to another database cannot join these transactions.
 *
 * @experimental
 * @param options - Redis state adapter configuration.
 * @throws Error if `keyPrefix` has no non-empty hash tag.
 * @throws TypeError if a `transactionRetry` field holds an invalid value.
 */
export const createRedisStateAdapter = ({
  stateProvider,
  keyPrefix = "{queuert}:",
  transactionRetry = { maxTries: 50, initialDelayMs: 2, multiplier: 2, maxDelayMs: 50 },
  ...configOptions
}: {
  /** The provider the adapter runs its Lua scripts through. */
  stateProvider: RedisStateProvider;
  /**
   * Prefix of every key the adapter writes. It must contain a non-empty hash tag such as
   * `{queuert}`, so a cluster stores every key in one slot; the factory throws otherwise.
   *
   * @defaultValue `"{queuert}:"`
   */
  keyPrefix?: string;
  /**
   * Retries of a transaction that conflicted with concurrent commits; after `maxTries` conflicting
   * tries it throws {@link RedisTransactionConflictError}.
   *
   * @defaultValue `{ maxTries: 50, initialDelayMs: 2, multiplier: 2, maxDelayMs: 50 }`
   */
  transactionRetry?: RetryConfig;
  /**
   * Function to generate new job IDs. Must return unique values: creating a job whose ID
   * already exists throws.
   *
   * @defaultValue `() => crypto.randomUUID()`
   */
  generateJobId?: () => string;
  /**
   * Predicate returning `true` if the ID is acceptable. Core runs it on both generated
   * and caller-supplied IDs before writing; failures throw `InvalidJobIdError`.
   */
  validateJobId?: (id: string) => boolean;
  /**
   * Function to generate the worker ID of a worker runner created without a `workerId`.
   * Called once per worker runner, which keeps the ID across restarts. Must return a new ID
   * on every call.
   *
   * @defaultValue `() => crypto.randomUUID()`
   */
  generateWorkerId?: () => string;
  /**
   * Predicate returning `true` if the worker ID is acceptable. Core runs it on both generated
   * and caller-supplied worker IDs when the worker runner is created; failures throw
   * `InvalidWorkerIdError`.
   */
  validateWorkerId?: (id: string) => boolean;
  /**
   * Most blocker chains a single job may declare. Declaring more throws
   * `JobBlockerLimitExceededError` before any state is written.
   *
   * @defaultValue `100`
   */
  maxBlockersPerJob?: number;
  /**
   * Per-status count at which `countChainsByTypeName` and `countJobsByTypeName` stop
   * counting and report `hasMore: true`.
   *
   * @defaultValue `10_000`
   */
  countCap?: number;
}): RedisStateAdapter => {
  if (!hasHashTag(keyPrefix)) {
    throw new Error(
      `Invalid keyPrefix "${keyPrefix}": it needs a non-empty hash tag such as "{queuert}" so Redis Cluster stores every key in one slot`,
    );
  }
  const transactionRetryViolations = retryConfigViolations("transactionRetry", transactionRetry);
  if (transactionRetryViolations.length > 0) {
    throw new TypeError(
      `createRedisStateAdapter: invalid configuration:\n${transactionRetryViolations.map((v) => `  - ${v}`).join("\n")}`,
    );
  }
  const config = resolveStateAdapterConfig(configOptions);
  const { countCap } = config;
  const closed = createLatch("StateAdapter is closed");

  const schema = createRedisSchema(keyPrefix);
  const { keys } = schema;

  const store: RedisStore = {
    provider: stateProvider,
    sequenceKey: keys.sequence,
    setVersionsKey: keys.setVersions,
    opaqueFields: opaqueRecordFields,
    commitKeyPrefix: keys.commit(""),
    lock: {
      keyOf: (recordKey) => keys.jobLock(recordKey.slice(keys.job("").length)),
      marker: '"status":"pending"',
      ttlMs: jobLockTtlMs,
    },
    fence: { key: keys.schemaFences, version: SCHEMA_VERSION },
  };

  const writeIndexEntries = (
    tx: RedisStoreTransaction,
    before: IndexEntries | undefined,
    after: IndexEntries | undefined,
  ) => {
    const empty: IndexEntries = { zsets: [], sets: [], counters: [] };
    const {
      zsets: beforeZsetEntries,
      sets: beforeSetEntries,
      counters: beforeCounters,
    } = before ?? empty;
    const {
      zsets: afterZsetEntries,
      sets: afterSetEntries,
      counters: afterCounters,
    } = after ?? empty;

    const afterZsets = new Map(
      afterZsetEntries.map(([key, member, score]) => [`${key}\n${member}`, score]),
    );
    const beforeZsets = new Map(
      beforeZsetEntries.map(([key, member, score]) => [`${key}\n${member}`, score]),
    );
    for (const [key, member] of beforeZsetEntries) {
      if (!afterZsets.has(`${key}\n${member}`)) tx.zrem(key, member);
    }
    for (const [key, member, score] of afterZsetEntries) {
      if (beforeZsets.get(`${key}\n${member}`) !== score) tx.zadd(key, member, score);
    }

    const afterSets = new Set(afterSetEntries.map(([key, member]) => `${key}\n${member}`));
    const beforeSets = new Set(beforeSetEntries.map(([key, member]) => `${key}\n${member}`));
    for (const [key, member] of beforeSetEntries) {
      if (!afterSets.has(`${key}\n${member}`)) tx.srem(key, member);
    }
    for (const [key, member] of afterSetEntries) {
      if (!beforeSets.has(`${key}\n${member}`)) tx.sadd(key, member);
    }

    for (const [key, field] of beforeCounters) tx.incr(key, field, -1);
    for (const [key, field] of afterCounters) tx.incr(key, field, 1);
  };

  const writeJob = (
    tx: RedisStoreTransaction,
    prev: DbJob | undefined,
    next: DbJob | undefined,
  ) => {
    const id = (next ?? prev)!.id;
    const stored = next ? serializeJob(next) : undefined;
    tx.putRecord(keys.job(id), stored);
    writeIndexEntries(
      tx,
      prev ? schema.jobIndexEntries(serializeJob(prev)) : undefined,
      stored ? schema.jobIndexEntries(stored) : undefined,
    );
  };

  const loadJobs = async (
    tx: RedisStoreTransaction,
    ids: string[],
    options?: { lock?: boolean },
  ): Promise<(DbJob | undefined)[]> =>
    (await tx.getRecords(ids.map(keys.job), options)).map((value) =>
      value === undefined ? undefined : deserializeJob(value as StoredJob),
    );

  const loadJob = async (tx: RedisStoreTransaction, id: string): Promise<DbJob | undefined> =>
    (await loadJobs(tx, [id]))[0];

  const loadWorker = async (
    tx: RedisStoreTransaction,
    id: string,
  ): Promise<DbWorker | undefined> => {
    const [value] = await tx.getRecords([keys.worker(id)]);
    return value === undefined ? undefined : deserializeWorker(value as StoredWorker);
  };

  const loadPresentJobs = async (tx: RedisStoreTransaction, ids: string[]): Promise<DbJob[]> =>
    (await loadJobs(tx, ids)).filter((job): job is DbJob => job !== undefined);

  const chainViews = async (
    tx: RedisStoreTransaction,
    heads: DbJob[],
    options?: { lockTails?: boolean },
  ): Promise<StateChain[]> => {
    const lasts = await tx.zlastMany(heads.map((head) => keys.chainJobs(head.id)));
    const tailIds = lasts.map((last, index) =>
      last === undefined || last.member === heads[index].id ? undefined : last.member,
    );
    const tails = await loadJobs(
      tx,
      tailIds.filter((id) => id !== undefined),
      { lock: options?.lockTails },
    );
    let tailIndex = 0;
    return heads.map((head, index) => {
      const tail = tailIds[index] === undefined ? undefined : tails[tailIndex++];
      return {
        ...chainInfo(head),
        head: jobInfo(head),
        tail: tail === undefined ? undefined : jobInfo(tail),
      };
    });
  };

  const newChainView = (head: DbJob): StateChain => ({
    ...chainInfo(head),
    head: jobInfo(head),
    tail: undefined,
  });

  const jobViews = async (tx: RedisStoreTransaction, jobs: DbJob[]): Promise<StateJob[]> => {
    const heads = await loadJobs(
      tx,
      jobs.map((job) => job.chainId),
    );
    return jobs.map((job, index) => ({
      ...jobInfo(job),
      chain: chainInfo(job.id === job.chainId ? job : (heads[index] ?? job)),
    }));
  };

  const runTransaction = async <T>(
    fn: (tx: RedisStoreTransaction, tryNumber: number) => Promise<T>,
  ): Promise<T> => {
    let conflict: RedisTransactionConflictError | undefined;
    return withRetry(
      async (tryNumber) => {
        closed.throwIfTripped();
        const { txHooks, flush, discard } = createTxHooks();
        const discardQuietly = async () => {
          try {
            await discard();
          } catch {}
        };
        const tx = createRedisTransaction(store, txHooks, tryNumber);
        let result: T;
        try {
          result = await fn(tx, tryNumber);
        } catch (error) {
          const { stale } = await tx.rollback().catch(() => ({ stale: false }));
          await discardQuietly();
          if (!stale) throw error;
          conflict = new RedisTransactionConflictError(
            `The Redis transaction conflicted with concurrent commits on each of its ${tryNumber} tries`,
            { tries: tryNumber, cause: error },
          );
          throw conflict;
        }
        let committed: boolean;
        try {
          committed = await tx.commit();
        } catch (error) {
          await discardQuietly();
          throw error;
        }
        if (committed) {
          await flush();
          return result;
        }
        await discardQuietly();
        conflict = new RedisTransactionConflictError(
          `The Redis transaction conflicted with concurrent commits on each of its ${tryNumber} tries`,
          { tries: tryNumber },
        );
        throw conflict;
      },
      transactionRetry,
      (error) => error === conflict,
    );
  };

  const transactionOf = (
    txCtx: Partial<RedisContext> | undefined,
  ): RedisStoreTransaction | undefined =>
    txCtx?.[transactionSymbol] as RedisStoreTransaction | undefined;

  const withRead = async <T>(
    txCtx: Partial<RedisContext> | undefined,
    fn: (tx: RedisStoreTransaction) => Promise<T>,
  ): Promise<T> => {
    closed.throwIfTripped();
    const tx = transactionOf(txCtx);
    return tx === undefined ? runTransaction(fn) : fn(tx);
  };

  const readChains = async ({
    txCtx,
    chainIds,
    lock,
    lockTails,
  }: {
    txCtx: Partial<RedisContext> | undefined;
    chainIds: string[];
    lock: "exclusive" | undefined;
    lockTails: boolean;
  }): Promise<(StateChain | undefined)[]> =>
    withRead(txCtx, async (tx) => {
      const locked = lock === "exclusive" && transactionOf(txCtx) !== undefined;
      const heads = (await loadJobs(tx, chainIds, { lock: locked })).map((head) =>
        head && head.id === head.chainId ? head : undefined,
      );
      const views = await chainViews(
        tx,
        heads.filter((head) => head !== undefined),
        { lockTails: lockTails && locked },
      );
      let viewIndex = 0;
      return heads.map((head) => (head === undefined ? undefined : views[viewIndex++]));
    });

  const withWrite = async <T>(
    txCtx: Partial<RedisContext> | undefined,
    fn: (tx: RedisStoreTransaction, tryNumber: number) => Promise<T>,
  ): Promise<T> => {
    const tx = transactionOf(txCtx);
    if (tx === undefined) return runTransaction(fn);
    const restore = tx.snapshot();
    try {
      return await fn(tx, tx.tryNumber);
    } catch (error) {
      if (tx.isOpen()) restore();
      throw error;
    }
  };

  const withFencedWrite = async <T>(
    txCtx: Partial<RedisContext> | undefined,
    fn: (tx: RedisStoreTransaction, tryNumber: number) => Promise<T>,
  ): Promise<T> =>
    withWrite(txCtx, async (tx, tryNumber) => {
      tx.requireFence();
      return fn(tx, tryNumber);
    });

  const requireTxHooks = (txCtx: Partial<RedisContext>) => {
    const txHooks = transactionOf(txCtx)?.txHooks;
    if (txHooks === undefined) {
      throw new Error(
        "The context has no Redis transaction: open it with the state adapter's withTransaction",
      );
    }
    return txHooks;
  };

  const buildJob = (params: {
    id: string;
    typeName: string;
    chainId: string;
    chainIndex: number;
    deduplicationKey: string | null;
    input: unknown;
    schedule?: ScheduleOptions;
    chainTraceContext?: string | null;
    traceContext?: string | null;
    now: Date;
  }): DbJob => ({
    id: params.id,
    typeName: params.typeName,
    chainId: params.chainId,
    chainIndex: params.chainIndex,
    chainStatus: params.chainIndex === 0 ? "running" : null,
    chainCompletedAt: null,
    continuedToId: null,
    input: params.input,
    output: null,
    status: "pending",
    createdAt: params.now,
    scheduledAt: resolveScheduledAt(params.schedule, params.now),
    completedAt: null,
    completedBy: null,
    attempt: 0,
    consecutiveFailures: 0,
    lastAttemptAt: null,
    lastAttemptError: null,
    lastRescheduleReason: null,
    attemptBy: null,
    attemptToken: null,
    attemptAt: null,
    deduplicationKey: params.deduplicationKey,
    chainTraceContext: params.chainTraceContext ?? null,
    traceContext: params.traceContext ?? null,
    seq: nextSeq(params.now),
    blocking: false,
    blockers: [],
  });

  const writeWorker = (
    tx: RedisStoreTransaction,
    prev: DbWorker | undefined,
    next: DbWorker | undefined,
  ) => {
    const id = (next ?? prev)!.id;
    const stored = next ? serializeWorker(next) : undefined;
    tx.putRecord(keys.worker(id), stored);
    writeIndexEntries(
      tx,
      prev ? schema.workerIndexEntries(serializeWorker(prev)) : undefined,
      stored ? schema.workerIndexEntries(stored) : undefined,
    );
  };

  const countWorkersByLease = async (
    tx: RedisStoreTransaction,
    pairs: [string, string][],
  ): Promise<{ live: number; expired: number }[]> => {
    const nowMs = Date.now();
    const [totals, live] = await Promise.all([
      tx.zcardMany(pairs.map(([leaseKey]) => leaseKey)),
      tx.zcountMany(pairs.map(([leaseKey]) => ({ key: leaseKey, min: nowMs + 1, max: Infinity }))),
    ]);
    return pairs.map((_, index) => ({ live: live[index], expired: totals[index] - live[index] }));
  };

  const unlockedDue = async (
    tx: RedisStoreTransaction,
    typeName: string,
    count: number,
    max?: number,
  ): Promise<ZsetMember[]> => {
    const found: ZsetMember[] = [];
    const batchSize = Math.min(Math.max(count + claimLockedSlack, 16), 500);
    let batch: ZsetMember[] = [];
    let scanned = 0;
    const keepUnlocked = async (): Promise<void> => {
      const locked = await tx.foreignLocks(batch.map(({ member }) => keys.job(dueJobId(member))));
      for (const [index, member] of batch.entries()) {
        if (!locked[index] && found.length < count) found.push(member);
      }
      batch = [];
    };
    for await (const member of tx.zscan(keys.due(typeName), { direction: "asc", max, batchSize })) {
      batch.push(member);
      scanned++;
      if (batch.length >= batchSize) {
        await keepUnlocked();
        if (found.length >= count) break;
      }
      if (scanned >= claimScanCap) break;
    }
    if (batch.length > 0 && found.length < count) await keepUnlocked();
    return found;
  };

  const adapter: RedisStateAdapter = {
    config,

    withTransaction: async (fn) => runTransaction(async (tx) => fn({ [transactionSymbol]: tx })),

    getTransaction: (txCtx) => {
      const transaction = transactionOf(txCtx);
      return transaction?.isOpen() ? (transaction.txHooks ?? transaction) : undefined;
    },

    onTransactionCommit: (txCtx, callback) => {
      requireTxHooks(txCtx).onCommit(callback);
    },

    onTransactionRollback: (txCtx, callback) => {
      requireTxHooks(txCtx).onRollback(callback);
    },

    getChains: async ({ txCtx, chainIds, lock }) =>
      readChains({ txCtx, chainIds, lock, lockTails: false }),

    getChainTails: async ({ txCtx, chainIds, lock }) =>
      (await readChains({ txCtx, chainIds, lock, lockTails: true })).map((view) => {
        if (view === undefined) return undefined;
        const { head, tail, ...chain } = view;
        return { ...(tail ?? head), chain };
      }),

    getJobs: async ({ txCtx, jobIds, lock }) =>
      withRead(txCtx, async (tx) => {
        const locked = lock === "exclusive" && transactionOf(txCtx) !== undefined;
        const jobs = await loadJobs(tx, jobIds, { lock: locked });
        const views = await jobViews(
          tx,
          jobs.filter((job) => job !== undefined),
        );
        let viewIndex = 0;
        return jobs.map((job) => (job === undefined ? undefined : views[viewIndex++]));
      }),

    getWorkers: async ({ txCtx, workerIds }) =>
      withRead(txCtx, async (tx) => {
        const nowMs = Date.now();
        const values = await tx.getRecords(workerIds.map(keys.worker));
        return values.map((value) =>
          value === undefined
            ? undefined
            : workerInfo(deserializeWorker(value as StoredWorker), nowMs),
        );
      }),

    createJobs: async ({ txCtx, jobs }) =>
      withFencedWrite(txCtx, async (tx) => {
        const now = new Date();
        const deduplicationRecordKeys = jobs.map(({ typeName, deduplication }) =>
          deduplication?.key ? keys.deduplication(typeName, deduplication.key) : undefined,
        );
        const presentDeduplicationKeys = deduplicationRecordKeys.filter((key) => key !== undefined);
        const jobKeys = jobs.map(({ id }) => keys.job(id));
        if (tx.tryNumber === 1) tx.assumeAbsent(jobKeys);
        const preloaded = await tx.getRecords([...presentDeduplicationKeys, ...jobKeys]);
        await loadJobs(
          tx,
          preloaded
            .slice(0, presentDeduplicationKeys.length)
            .flatMap((stored) => (stored as string[] | undefined) ?? []),
        );

        const results: (StateChain & { deduplicated: boolean })[] = [];
        const deduplicatedHeads = new Map<number, DbJob>();
        for (const [index, jobInput] of jobs.entries()) {
          const { typeName, id, input, schedule, chainTraceContext, traceContext, deduplication } =
            jobInput;
          const deduplicationRecordKey = deduplicationRecordKeys[index];
          const runningChainIds: string[] = [];
          if (deduplication && deduplicationRecordKey !== undefined) {
            const [stored] = await tx.getRecords([deduplicationRecordKey]);
            let match: DbJob | undefined;
            for (const head of await loadPresentJobs(tx, (stored as string[] | undefined) ?? [])) {
              if (head.chainStatus === "running") runningChainIds.push(head.id);
              if (deduplication.scope === "running" && head.chainStatus !== "running") continue;
              if (!match || head.createdAt > match.createdAt) match = head;
            }
            if (match) {
              deduplicatedHeads.set(index, match);
              results.push({ ...newChainView(match), deduplicated: true });
              continue;
            }
          }

          assertWellFormed("Job id", id);
          assertWellFormed("Job type name", typeName);
          if ((await loadJob(tx, id)) !== undefined) {
            throw new Error(`Job id "${id}" already exists`);
          }

          const job = buildJob({
            id,
            typeName,
            chainId: id,
            chainIndex: 0,
            deduplicationKey: deduplication?.key ?? null,
            input,
            schedule,
            chainTraceContext,
            traceContext,
            now,
          });
          writeJob(tx, undefined, job);
          if (deduplicationRecordKey !== undefined) {
            tx.putRecord(deduplicationRecordKey, [...runningChainIds, id]);
          }
          results.push({ ...newChainView(job), deduplicated: false });
        }
        if (deduplicatedHeads.size > 0) {
          const views = await chainViews(tx, [...deduplicatedHeads.values()]);
          for (const [viewIndex, index] of [...deduplicatedHeads.keys()].entries()) {
            results[index] = { ...views[viewIndex], deduplicated: true };
          }
        }
        return results;
      }),

    continueJobs: async ({ txCtx, jobs }) =>
      withFencedWrite(txCtx, async (tx) => {
        const now = new Date();
        if (tx.tryNumber === 1) tx.assumeAbsent(jobs.map(({ id }) => keys.job(id)));
        const loaded = await loadJobs(tx, [
          ...jobs.map(({ continueFromId }) => continueFromId),
          ...jobs.map(({ id }) => id),
        ]);
        const parents = loaded
          .slice(0, jobs.length)
          .map((parent, index) =>
            !parent ||
            parent.status === "completed" ||
            !holdsAttempt(parent, jobs[index].attemptToken)
              ? undefined
              : parent,
          );
        const liveParents = parents.filter((parent) => parent !== undefined);
        await loadJobs(
          tx,
          liveParents.map((parent) => parent.chainId),
        );

        const continuations: (StateJobInfo | undefined)[] = [];
        const completedJobs: DbJob[] = [];
        const takenPositions = new Set<string>();
        for (const [index, jobInput] of jobs.entries()) {
          const parent = parents[index];
          if (!parent) {
            continuations.push(undefined);
            continue;
          }
          const chainIndex = parent.chainIndex + 1;
          const position = `${parent.chainId}\n${chainIndex}`;
          if (takenPositions.has(position)) {
            throw new Error(`Chain "${parent.chainId}" already has a job at index ${chainIndex}`);
          }
          takenPositions.add(position);
          assertWellFormed("Job id", jobInput.id);
          assertWellFormed("Job type name", jobInput.typeName);
          if ((await loadJob(tx, jobInput.id)) !== undefined) {
            throw new Error(`Job id "${jobInput.id}" already exists`);
          }

          const continuation = buildJob({
            id: jobInput.id,
            typeName: jobInput.typeName,
            chainId: parent.chainId,
            chainIndex,
            deduplicationKey: null,
            input: jobInput.input,
            schedule: jobInput.schedule,
            chainTraceContext: null,
            traceContext: jobInput.traceContext,
            now,
          });
          writeJob(tx, undefined, continuation);

          const completed: DbJob = {
            ...parent,
            attemptAt: null,
            attemptBy: null,
            attemptToken: null,
            continuedToId: jobInput.id,
            status: "completed",
            completedAt: now,
            completedBy: jobInput.workerId ?? null,
            output: null,
            consecutiveFailures: 0,
            lastAttemptError: null,
            lastRescheduleReason: null,
          };
          writeJob(tx, parent, completed);
          completedJobs.push(completed);
          continuations.push(jobInfo(continuation));
        }
        const views = await jobViews(tx, completedJobs);
        let viewIndex = 0;
        return continuations.map((continuation) =>
          continuation === undefined ? undefined : { ...views[viewIndex++], continuation },
        );
      }),

    completeJobs: async ({ txCtx, jobs }) =>
      withFencedWrite(txCtx, async (tx) => {
        const now = new Date();
        const loaded = (
          await tx.getRecords(
            jobs.map(({ jobId }) => keys.job(jobId)),
            { validatedSets: jobs.map(({ jobId }) => keys.blockedBy(jobId)) },
          )
        ).map((value) => (value === undefined ? undefined : deserializeJob(value as StoredJob)));
        await loadJobs(
          tx,
          loaded.filter((job) => job !== undefined).map((job) => job.chainId),
        );
        const completedJobs: (DbJob | undefined)[] = [];
        for (const { jobId, output, attemptToken, workerId } of jobs) {
          const job = await loadJob(tx, jobId);
          if (!job || job.status === "completed" || !holdsAttempt(job, attemptToken)) {
            completedJobs.push(undefined);
            continue;
          }
          const isHead = job.id === job.chainId;
          const updated: DbJob = {
            ...job,
            attemptAt: null,
            attemptBy: null,
            attemptToken: null,
            output: output ?? null,
            status: "completed",
            completedAt: now,
            completedBy: workerId ?? null,
            consecutiveFailures: 0,
            lastAttemptError: null,
            lastRescheduleReason: null,
            ...(isHead ? { chainStatus: "completed" as const, chainCompletedAt: now } : {}),
          };
          writeJob(tx, job, updated);
          if (!isHead) {
            const head = await loadJob(tx, job.chainId);
            if (!head) throw new Error(`Chain ${job.chainId} not found`);
            writeJob(tx, head, {
              ...head,
              chainStatus: "completed",
              chainCompletedAt: head.chainCompletedAt ?? now,
            });
          }
          completedJobs.push(updated);
        }
        const views = await jobViews(
          tx,
          completedJobs.filter((job) => job !== undefined),
        );
        let viewIndex = 0;
        return completedJobs.map((job) => (job === undefined ? undefined : views[viewIndex++]));
      }),

    rescheduleJobs: async ({ txCtx, jobs }) =>
      withFencedWrite(txCtx, async (tx) => {
        const now = new Date();
        const loaded = await loadJobs(
          tx,
          jobs.map(({ jobId }) => jobId),
        );
        await loadJobs(
          tx,
          loaded.filter((job) => job !== undefined).map((job) => job.chainId),
        );
        const resultById = new Map<string, DbJob | undefined>();
        for (const { jobId, schedule, error, reason, attemptToken } of jobs) {
          if (resultById.has(jobId)) continue;
          const job = await loadJob(tx, jobId);
          if (!job || job.status === "completed" || !holdsAttempt(job, attemptToken)) {
            resultById.set(jobId, undefined);
            continue;
          }
          const running = job.status === "running";
          const failed = running && error !== undefined;
          const updated: DbJob = {
            ...job,
            status: running ? "pending" : job.status,
            scheduledAt: resolveScheduledAt(schedule, now),
            consecutiveFailures: failed ? job.consecutiveFailures + 1 : 0,
            lastAttemptAt: running ? now : job.lastAttemptAt,
            lastAttemptError: running ? (error ?? null) : job.lastAttemptError,
            lastRescheduleReason: failed ? null : (reason ?? null),
            attemptAt: null,
            attemptBy: null,
            attemptToken: null,
          };
          writeJob(tx, job, updated);
          resultById.set(jobId, updated);
        }
        const rescheduled = [...resultById.values()].filter((job) => job !== undefined);
        const views = new Map(
          (await jobViews(tx, rescheduled)).map((view) => [view.id, view] as const),
        );
        return jobs.map(({ jobId }) => views.get(jobId));
      }),

    deleteChains: async ({ txCtx, chainIds }) =>
      withFencedWrite(txCtx, async (tx) => {
        const uniqueChainIds = new Set(chainIds);
        const loadedHeads = await loadJobs(tx, [...uniqueChainIds]);
        const heads = new Map(
          [...uniqueChainIds].map((chainId, index) => {
            const head = loadedHeads[index];
            return [chainId, head && head.id === head.chainId ? head : undefined] as const;
          }),
        );

        const presentHeads = [...heads.values()].filter((head) => head !== undefined);
        const views = new Map(
          (await chainViews(tx, presentHeads)).map((view) => [view.id, view] as const),
        );

        const referencedChainIds = new Set<string>();
        const members = await tx.zmembersMany(presentHeads.map((head) => keys.chainJobs(head.id)));
        for (const job of await loadPresentJobs(
          tx,
          members.flat().map(({ member }) => member),
        )) {
          for (const blocker of job.blockers) {
            if (!uniqueChainIds.has(blocker.blockedByChainId)) {
              referencedChainIds.add(blocker.blockedByChainId);
            }
          }
          writeJob(tx, job, undefined);
        }

        const deletedIdsByDeduplicationKey = Map.groupBy(
          presentHeads.filter((head) => head.deduplicationKey),
          (head) => keys.deduplication(head.typeName, head.deduplicationKey!),
        );
        const deduplicationRecordKeys = [...deletedIdsByDeduplicationKey.keys()];
        const storedDeduplications = await tx.getRecords(deduplicationRecordKeys);
        for (const [index, deduplicationRecordKey] of deduplicationRecordKeys.entries()) {
          const deletedIds = new Set(
            deletedIdsByDeduplicationKey.get(deduplicationRecordKey)!.map((head) => head.id),
          );
          const remaining = ((storedDeduplications[index] as string[] | undefined) ?? []).filter(
            (id) => !deletedIds.has(id),
          );
          tx.putRecord(deduplicationRecordKey, remaining.length > 0 ? remaining : undefined);
        }

        const referencedIds = [...referencedChainIds];
        const referencedDependentIds = await tx.smembersMany(referencedIds.map(keys.blockedBy), {
          validate: true,
        });
        const unreferencedIds = referencedIds.filter(
          (_, index) => referencedDependentIds[index].length === 0,
        );
        for (const head of await loadPresentJobs(tx, unreferencedIds)) {
          if (head.id === head.chainId && head.blocking) {
            writeJob(tx, head, { ...head, blocking: false });
          }
        }

        return chainIds.map((chainId) => {
          const view = views.get(chainId);
          return view && { ...view, blocking: false };
        });
      }),

    startJobAttempts: async ({ txCtx, batchLimits, workerId, workerToken, limit }) => {
      if (limit <= 0) return [];
      if (transactionOf(txCtx) === undefined) {
        closed.throwIfTripped();
        const claimed = (await stateProvider
          .eval(
            CLAIM_SCRIPT,
            [keys.sequence],
            [
              JSON.stringify({
                prefix: keyPrefix,
                fenceKey: keys.schemaFences,
                fenceVersion: String(SCHEMA_VERSION),
                workerId,
                workerToken,
                now: Date.now(),
                limit,
                lockedSlack: claimLockedSlack,
                scanCap: claimScanCap,
                replayTtlMs,
                batchLimits,
                attemptTokens: Array.from(
                  { length: limit * Math.max(1, ...Object.values(batchLimits)) },
                  () => crypto.randomUUID(),
                ),
              }),
            ],
          )
          .catch((error: unknown) => {
            throw toSchemaFencedError(error, SCHEMA_VERSION);
          })) as (string | null)[];
        const acquired: (StateJob & { hasBlockers: boolean })[] = [];
        for (let index = 0; index < claimed.length; index += 4) {
          const job = deserializeJob(
            decodeRecord(claimed[index]!, claimed[index + 1]) as StoredJob,
          );
          const headData = claimed[index + 2];
          const head =
            headData === null
              ? job
              : deserializeJob(decodeRecord(headData, claimed[index + 3]) as StoredJob);
          acquired.push({
            ...jobInfo(job),
            chain: chainInfo(head),
            hasBlockers: job.blockers.length > 0,
          });
        }
        return acquired;
      }
      return withFencedWrite(txCtx, async (tx, tryNumber) => {
        const now = new Date();
        const nowMs = now.getTime();
        const acquired: (StateJob & { hasBlockers: boolean })[] = [];
        const worker = await loadWorker(tx, workerId);
        if (!worker || worker.token !== workerToken || !isLive(worker, nowMs)) return acquired;

        let acquiredBatches = 0;
        while (acquiredBatches < limit) {
          const remaining = limit - acquiredBatches;
          const window = tryNumber === 1 ? remaining : remaining * Math.min(2 ** tryNumber, 64);
          const batches = (
            await Promise.all(
              Object.entries(batchLimits).map(async ([typeName, batchLimit]) =>
                chunk(await unlockedDue(tx, typeName, window * batchLimit, nowMs), batchLimit),
              ),
            )
          )
            .flat()
            .toSorted((a, b) => compareZsetMembers(a[0], b[0]))
            .slice(0, window);
          const candidateBatches =
            window === remaining
              ? batches
              : batches
                  .map((batch) => ({ batch, order: Math.random() }))
                  .toSorted((a, b) => a.order - b.order)
                  .slice(0, remaining)
                  .map(({ batch }) => batch);
          if (candidateBatches.length === 0) break;

          const claimable = (
            await loadPresentJobs(
              tx,
              candidateBatches.flat().map(({ member }) => dueJobId(member)),
            )
          ).filter((job) => job.status === "pending" && job.scheduledAt.getTime() <= nowMs);
          await loadJobs(
            tx,
            claimable.map((job) => job.id),
            { lock: true },
          );
          const claimed: DbJob[] = [];
          for (const job of claimable) {
            const updated: DbJob = {
              ...job,
              status: "running",
              attempt: job.attempt + 1,
              attemptAt: now,
              attemptBy: workerId,
              attemptToken: crypto.randomUUID(),
            };
            writeJob(tx, job, updated);
            claimed.push(updated);
          }
          for (const [index, view] of (await jobViews(tx, claimed)).entries()) {
            acquired.push({ ...view, hasBlockers: claimed[index].blockers.length > 0 });
          }
          if (claimed.length === 0) break;
          const claimedIds = new Set(claimed.map((job) => job.id));
          acquiredBatches += candidateBatches.filter((batch) =>
            batch.some(({ member }) => claimedIds.has(dueJobId(member))),
          ).length;
        }
        return acquired;
      });
    },

    getStartAttemptDelayMs: async ({ txCtx, typeNames }) =>
      withRead(txCtx, async (tx) => {
        const firstUnlocked = async (typeName: string): Promise<number[]> =>
          (await unlockedDue(tx, typeName, 1)).map(({ score }) => score);
        const scores = (await Promise.all(typeNames.map(firstUnlocked))).flat();
        if (scores.length === 0) return null;
        return Math.max(0, Math.min(...scores) - Date.now());
      }),

    addJobsBlockers: async ({ txCtx, jobBlockers }) =>
      withFencedWrite(txCtx, async (tx) => {
        const jobs = await loadJobs(
          tx,
          jobBlockers.map(({ jobId }) => jobId),
        );
        const missingJobIds = jobBlockers
          .filter((_, index) => jobs[index] === undefined)
          .map(({ jobId }) => jobId);
        if (missingJobIds.length > 0) {
          throw new Error(
            `addJobsBlockers requires existing jobs; not found: ${missingJobIds.join(", ")}`,
          );
        }

        await loadJobs(tx, [
          ...jobs.filter((job) => job !== undefined).map((job) => job.chainId),
          ...jobBlockers.flatMap(({ blockedByChainIds }) => blockedByChainIds),
        ]);
        const updatedJobs: DbJob[] = [];
        const blockersByJob: (StateChainInfo | undefined)[][] = [];
        for (const { jobId, blockedByChainIds, blockerTraceContexts } of jobBlockers) {
          const blockerHeads = (await loadJobs(tx, blockedByChainIds)).map((head) =>
            head && head.id === head.chainId ? head : undefined,
          );
          for (const head of new Set(blockerHeads)) {
            if (head && !head.blocking) writeJob(tx, head, { ...head, blocking: true });
          }
          const job = (await loadJob(tx, jobId))!;
          const blockerEntries = new Map(
            job.blockers.map((entry) => [`${entry.blockedByChainId}\n${entry.index}`, entry]),
          );
          const blockers = blockedByChainIds.map((blockerChainId, index) => {
            const head = blockerHeads[index];
            if (!head) return undefined;
            blockerEntries.set(`${blockerChainId}\n${index}`, {
              blockedByChainId: blockerChainId,
              index,
              traceContext: blockerTraceContexts?.[index] ?? null,
            });
            return { ...chainInfo(head), blocking: true };
          });
          const hasIncomplete = blockers.some((chain) => chain?.status === "running");
          const updated: DbJob = {
            ...job,
            blockers: [...blockerEntries.values()].toSorted((a, b) => a.index - b.index),
            ...(hasIncomplete && job.status === "pending" ? { status: "blocked" as const } : {}),
          };
          writeJob(tx, job, updated);
          updatedJobs.push(updated);
          blockersByJob.push(blockers);
        }
        const finalJobs = await loadPresentJobs(
          tx,
          updatedJobs.map((job) => job.id),
        );
        return (await jobViews(tx, finalJobs)).map((view, index) => ({
          ...view,
          blockers: blockersByJob[index],
        }));
      }),

    getJobsBlockers: async ({ txCtx, jobIds }) =>
      withRead(txCtx, async (tx) => {
        const jobs = await loadJobs(tx, jobIds);
        const blockerChainIds = jobs.map((job) =>
          (job?.blockers ?? [])
            .toSorted((a, b) => a.index - b.index)
            .map((blocker) => blocker.blockedByChainId),
        );
        const heads = await loadPresentJobs(tx, [...new Set(blockerChainIds.flat())]);
        const chainsById = new Map((await chainViews(tx, heads)).map((chain) => [chain.id, chain]));
        return blockerChainIds.map((ids) => ids.flatMap((id) => chainsById.get(id) ?? []));
      }),

    unblockJobs: async ({ txCtx, blockedByChainId }) =>
      withFencedWrite(txCtx, async (tx) => {
        const now = new Date();
        const dependentIds = await tx.smembers(keys.blockedBy(blockedByChainId), {
          validate: true,
        });
        const dependents = await loadPresentJobs(tx, dependentIds);
        await loadJobs(tx, [
          ...dependents.map((job) => job.chainId),
          ...dependents
            .filter((job) => job.status === "blocked")
            .flatMap((job) => job.blockers.map((blocker) => blocker.blockedByChainId)),
        ]);
        const entriesByJob: [DbJob, BlockerEntry[]][] = [];
        for (let job of dependents) {
          const entries = job.blockers
            .filter((blocker) => blocker.blockedByChainId === blockedByChainId)
            .toSorted((a, b) => a.index - b.index);
          if (entries.length === 0) continue;
          if (job.status === "blocked") {
            const blockerHeads = await loadJobs(
              tx,
              job.blockers.map((blocker) => blocker.blockedByChainId),
            );
            if (blockerHeads.every((head) => head?.chainStatus === "completed")) {
              const updated: DbJob = {
                ...job,
                status: "pending",
                scheduledAt: clampToFloor(job.scheduledAt, now),
              };
              writeJob(tx, job, updated);
              job = updated;
            }
          }
          entriesByJob.push([job, entries]);
        }
        const views = await jobViews(
          tx,
          entriesByJob.map(([job]) => job),
        );
        return entriesByJob
          .flatMap(([job, entries], index) =>
            entries.map((entry) => ({
              jobId: job.id,
              blockedByChainId,
              index: entry.index,
              traceContext: entry.traceContext,
              job: views[index],
            })),
          )
          .toSorted((a, b) => compareStrings(a.jobId, b.jobId) || a.index - b.index);
      }),

    startWorker: async ({ txCtx, workerId, typeNames, concurrency, leaseMs }) =>
      withFencedWrite(txCtx, async (tx) => {
        const nowMs = Date.now();
        assertWellFormed("Worker id", workerId);
        for (const typeName of typeNames) assertWellFormed("Job type name", typeName);
        if ((await loadWorker(tx, workerId)) !== undefined) {
          throw new Error(`Worker id "${workerId}" already exists`);
        }
        const worker: DbWorker = {
          id: workerId,
          typeNames: [...typeNames],
          concurrency,
          startedAt: new Date(nowMs),
          leaseUntil: new Date(nowMs + leaseMs),
          token: crypto.randomUUID(),
        };
        writeWorker(tx, undefined, worker);
        return workerInfo(worker, nowMs);
      }),

    extendWorkerLease: async ({ txCtx, workerId, workerToken, leaseMs }) =>
      withFencedWrite(txCtx, async (tx) => {
        const nowMs = Date.now();
        const worker = await loadWorker(tx, workerId);
        if (!worker || worker.token !== workerToken || !isLive(worker, nowMs)) return undefined;
        const renewed: DbWorker = { ...worker, leaseUntil: new Date(nowMs + leaseMs) };
        writeWorker(tx, worker, renewed);
        return workerInfo(renewed, nowMs);
      }),

    stopWorker: async ({ txCtx, workerId, workerToken }) =>
      withFencedWrite(txCtx, async (tx) => {
        const worker = await loadWorker(tx, workerId);
        if (!worker || worker.token !== workerToken) return undefined;
        writeWorker(tx, worker, undefined);
        return workerInfo(worker, Date.now());
      }),

    getChainTypeNames: async ({ txCtx }) =>
      withRead(txCtx, async (tx) => [...(await tx.counterEntries(keys.chainTypeNames)).keys()]),

    getJobTypeNames: async ({ txCtx }) =>
      withRead(txCtx, async (tx) => [...(await tx.counterEntries(keys.jobTypeNames)).keys()]),

    countChainsByTypeName: async ({ txCtx, typeNames }) =>
      withRead(txCtx, async (tx) => {
        const counts = await tx.zcardMany(
          typeNames.flatMap((typeName) => [
            keys.chains("createdAt", "running", typeName),
            keys.chains("createdAt", "completed", typeName),
          ]),
        );
        return typeNames.map((_, index) => ({
          running: capCount(counts[index * 2], countCap),
          completed: capCount(counts[index * 2 + 1], countCap),
        }));
      }),

    countJobsByTypeName: async ({ txCtx, typeNames }) =>
      withRead(txCtx, async (tx) => {
        const statuses = ["blocked", "pending", "running", "completed"] as const;
        const counts = await tx.zcardMany(
          typeNames.flatMap((typeName) =>
            statuses.map((status) => keys.jobs("createdAt", status, typeName)),
          ),
        );
        return typeNames.map((_, index) => ({
          blocked: capCount(counts[index * 4], countCap),
          pending: capCount(counts[index * 4 + 1], countCap),
          running: capCount(counts[index * 4 + 2], countCap),
          completed: capCount(counts[index * 4 + 3], countCap),
        }));
      }),

    countWorkers: async ({ txCtx }) =>
      withRead(txCtx, async (tx) => (await countWorkersByLease(tx, [[keys.workerLeases, ""]]))[0]),

    countWorkersByTypeName: async ({ txCtx, typeNames }) =>
      withRead(txCtx, async (tx) =>
        countWorkersByLease(
          tx,
          typeNames.map((typeName) => [keys.workerLeasesOfType(typeName), typeName]),
        ),
      ),

    countRunningJobsByWorkerId: async ({ txCtx, workerIds }) =>
      withRead(txCtx, async (tx) => tx.zcardMany(workerIds.map(keys.running))),

    listChains: async ({
      txCtx,
      typeName,
      blocking,
      from,
      to,
      status,
      orderBy,
      orderDirection,
      page,
    }) =>
      withRead(txCtx, async (tx) => {
        const members: ZsetMember[] = [];
        const batchSize = blocking === false ? 200 : scanBatchSize(page.limit);
        let batch: ZsetMember[] = [];
        const flush = async () => {
          if (batch.length === 0) return;
          const references =
            blocking !== false
              ? undefined
              : await tx.counterValues(
                  keys.blockerReferences,
                  batch.map(({ member }) => member),
                );
          for (const [index, member] of batch.entries()) {
            if (references !== undefined && references[index] > 0) continue;
            if (members.length <= page.limit) members.push(member);
          }
          batch = [];
        };
        const chainsKey = blocking === true ? keys.blockingChains : keys.chains;
        for await (const member of tx.zscan(chainsKey(orderBy, status ?? "all", typeName), {
          direction: orderDirection,
          min: from?.getTime(),
          max: to?.getTime(),
          after: timestampCursorStart(page.cursor, orderBy),
          batchSize,
        })) {
          batch.push(member);
          if (batch.length >= batchSize) await flush();
          if (members.length > page.limit) break;
        }
        await flush();
        const heads = await loadPresentJobs(
          tx,
          members.slice(0, page.limit).map(({ member }) => member),
        );
        return timestampPage(await chainViews(tx, heads), members, page.limit, orderBy);
      }),

    listJobs: async (params) =>
      withRead(params.txCtx, async (tx) => {
        const { typeName, from, to, status, orderBy, orderDirection, page } = params;
        const members = await takeMembers(
          tx.zscan(keys.jobs(orderBy, status ?? "all", typeName), {
            direction: orderDirection,
            min: from?.getTime(),
            max: to?.getTime(),
            after: timestampCursorStart(page.cursor, orderBy),
            batchSize: scanBatchSize(page.limit),
          }),
          page.limit + 1,
        );
        const jobs = await loadPresentJobs(
          tx,
          members.slice(0, page.limit).map(({ member }) => member),
        );
        return timestampPage(await jobViews(tx, jobs), members, page.limit, orderBy);
      }),

    listChainJobs: async ({ txCtx, chainId, orderDirection, page }) =>
      withRead(txCtx, async (tx) => {
        let after: ZsetMember | undefined;
        if (page.cursor) {
          const cursorJob = await loadJob(tx, decodeIdCursor(page.cursor).id);
          if (!cursorJob) return { items: [], nextCursor: null };
          after = { score: cursorJob.chainIndex, member: cursorJob.id };
        }
        const members = await takeMembers(
          tx.zscan(keys.chainJobs(chainId), {
            direction: orderDirection,
            after,
            batchSize: scanBatchSize(page.limit),
          }),
          page.limit + 1,
        );
        const [head, ...jobs] = await loadJobs(tx, [
          chainId,
          ...members.slice(0, page.limit).map(({ member }) => member),
        ]);
        const lastItem = members[page.limit - 1];
        return {
          items: head
            ? jobs
                .filter((job) => job !== undefined)
                .map((job) => ({ ...jobInfo(job), chain: chainInfo(head) }))
            : [],
          nextCursor:
            members.length > page.limit && lastItem
              ? encodeCursor({ type: "id", id: lastItem.member })
              : null,
        };
      }),

    listBlockedJobs: async ({ txCtx, chainId, orderDirection, page }) =>
      withRead(txCtx, async (tx) => {
        const members = await takeMembers(
          tx.zscan(keys.blockedJobs(chainId), {
            direction: orderDirection,
            after: timestampCursorStart(page.cursor, "createdAt"),
            batchSize: scanBatchSize(page.limit),
          }),
          page.limit + 1,
        );
        const jobs = await loadPresentJobs(
          tx,
          members.slice(0, page.limit).map(({ member }) => member),
        );
        return timestampPage(await jobViews(tx, jobs), members, page.limit, "createdAt");
      }),

    listWorkers: async ({ txCtx, typeName, status, orderDirection, page }) =>
      withRead(txCtx, async (tx) => {
        const nowMs = Date.now();
        const workers: DbWorker[] = [];
        const members: ZsetMember[] = [];
        const batchSize = scanBatchSize(page.limit);
        let batch: ZsetMember[] = [];
        const flush = async () => {
          if (batch.length === 0) return;
          const values = await tx.getRecords(batch.map(({ member }) => keys.worker(member)));
          for (const [index, value] of values.entries()) {
            if (value === undefined) continue;
            const worker = deserializeWorker(value as StoredWorker);
            if (status !== undefined && isLive(worker, nowMs) !== (status === "live")) continue;
            if (members.length <= page.limit) {
              members.push(batch[index]);
              workers.push(worker);
            }
          }
          batch = [];
        };
        for await (const member of tx.zscan(
          typeName === undefined ? keys.workers : keys.workersOfType(typeName),
          {
            direction: orderDirection,
            after: timestampCursorStart(page.cursor, "startedAt"),
            batchSize,
          },
        )) {
          batch.push(member);
          if (batch.length >= batchSize) await flush();
          if (members.length > page.limit) break;
        }
        await flush();
        return timestampPage(
          workers.slice(0, page.limit).map((worker) => workerInfo(worker, nowMs)),
          members,
          page.limit,
          "startedAt",
        );
      }),

    listWorkerJobs: async ({ txCtx, workerId, orderDirection, page }) =>
      withRead(txCtx, async (tx) => {
        const members = await takeMembers(
          tx.zscan(keys.running(workerId), {
            direction: orderDirection,
            after: timestampCursorStart(page.cursor, "attemptAt"),
            batchSize: scanBatchSize(page.limit),
          }),
          page.limit + 1,
        );
        const jobs = await loadPresentJobs(
          tx,
          members.slice(0, page.limit).map(({ member }) => member),
        );
        return timestampPage(await jobViews(tx, jobs), members, page.limit, "attemptAt");
      }),

    migrateToLatest: async () => {
      closed.throwIfTripped();
      const withTransaction = async <T>(fn: (txCtx: RedisStoreContext) => Promise<T>) =>
        runTransaction(async (tx) => fn({ transaction: tx }));
      return migrateRedisSchemaToLatest({ schema, stateProvider, withTransaction });
    },

    close: async () => {
      if (!closed.trip()) return;
      await stateProvider.close?.();
    },

    [Symbol.asyncDispose]: async () => adapter.close(),
  };

  return adapter;
};
