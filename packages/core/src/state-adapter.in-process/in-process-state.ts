import { createLatch } from "@queuert/helpers/latch";

import type { DeduplicationOptions } from "../entities/deduplication.ts";
import type { OrderDirection, Page, PageParams } from "../entities/pagination.ts";
import type { ScheduleOptions } from "../entities/schedule.ts";
import { resolveStateAdapterConfig } from "../state-adapter/adapter-config.ts";
import {
  decodeIdCursor,
  decodeTimestampWithIdCursor,
  encodeCursor,
} from "../state-adapter/cursor.ts";
import type {
  StateAdapterOperations,
  StateBlockedJob,
  StateChain,
  StateChainInfo,
  StateChainStatus,
  StateDependentJob,
  StateJob,
  StateJobInfo,
  StateJobStatus,
  StateWorkerInfo,
} from "../state-adapter/state-adapter.ts";
import type { TxHooks } from "../tx-hooks/tx-hooks.ts";
import {
  type SortedList,
  createSortedList,
  deleteFromSortedList,
  firstOfSortedList,
  insertIntoSortedList,
  sortedListToArray,
  takeFromSortedList,
} from "./sorted-list.ts";

type ChainState = { readonly info: StateChainInfo; readonly blocking: boolean };

type BlockerRow = {
  readonly blockedByChainId: string;
  readonly index: number;
  readonly traceContext: string | null;
  readonly chain: ChainSlot;
};

type JobSlot = {
  readonly id: string;
  readonly seq: number;
  readonly chain: ChainSlot;
  state: StateJobInfo | undefined;
  blockers: readonly BlockerRow[];
};

type ChainSlot = {
  readonly id: string;
  readonly deduplicationIndexKey: string | undefined;
  state: ChainState | undefined;
  readonly jobs: (JobSlot | undefined)[];
  dependents: SortedList<JobSlot> | undefined;
};

type WorkerRow = Omit<StateWorkerInfo, "expired">;

type UndoEntry =
  | { kind: "job"; slot: JobSlot; prev: StateJobInfo | undefined }
  | { kind: "chain"; slot: ChainSlot; prev: ChainState | undefined }
  | { kind: "blockers"; slot: JobSlot; prev: readonly BlockerRow[] }
  | { kind: "worker"; id: string; prev: WorkerRow | undefined };

type JobCounts = Record<StateJobStatus, number>;
type ChainCounts = Record<StateChainStatus, number>;

const NO_BLOCKERS: readonly BlockerRow[] = [];

const compareIds = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const holdsAttempt = (job: StateJobInfo, attemptToken: string | undefined): boolean =>
  attemptToken === undefined || (job.status === "running" && job.attemptToken === attemptToken);

const isLive = (worker: WorkerRow, nowMs: number): boolean => worker.leaseUntil.getTime() > nowMs;

const resolveScheduledAt = (schedule: ScheduleOptions | undefined, now: Date): Date => {
  const requested =
    schedule?.at ?? (schedule?.afterMs ? new Date(now.getTime() + schedule.afterMs) : now);
  return requested.getTime() > now.getTime() ? requested : now;
};

const capCount = (count: number, countCap: number) => ({
  count: Math.min(count, countCap),
  hasMore: count > countCap,
});

type SlotIndex<TSlot, TState> = {
  readonly buckets: Map<string, SortedList<TSlot>>;
  compare: (a: TSlot, b: TSlot) => number;
  moves: (prev: TState, next: TState) => boolean;
  remove: (slot: TSlot, prev: TState) => void;
  insert: (slot: TSlot, next: TState) => void;
};

const createSlotIndex = <TSlot extends { state: TState | undefined }, TState>({
  bucketOf,
  keyOf,
  tie,
  slots,
}: {
  bucketOf: (state: TState) => string | undefined;
  keyOf: (state: TState) => number;
  tie: (a: TSlot, b: TSlot) => number;
  slots: Iterable<TSlot>;
}): SlotIndex<TSlot, TState> => {
  const compare = (a: TSlot, b: TSlot): number => keyOf(a.state!) - keyOf(b.state!) || tie(a, b);

  const grouped = new Map<string, TSlot[]>();
  for (const slot of slots) {
    const bucket = bucketOf(slot.state!);
    if (bucket === undefined) continue;
    let items = grouped.get(bucket);
    if (items === undefined) {
      items = [];
      grouped.set(bucket, items);
    }
    items.push(slot);
  }
  const buckets = new Map<string, SortedList<TSlot>>();
  for (const [bucket, items] of grouped) {
    buckets.set(bucket, createSortedList(compare, items.sort(compare)));
  }

  return {
    buckets,
    compare,
    moves: (prev, next) => {
      const bucket = bucketOf(prev);
      return bucket !== bucketOf(next) || (bucket !== undefined && keyOf(prev) !== keyOf(next));
    },
    remove: (slot, prev) => {
      const bucket = bucketOf(prev);
      if (bucket === undefined) return;
      const list = buckets.get(bucket);
      if (list === undefined) return;
      deleteFromSortedList(list, slot);
      if (list.size === 0) buckets.delete(bucket);
    },
    insert: (slot, next) => {
      const bucket = bucketOf(next);
      if (bucket === undefined) return;
      let list = buckets.get(bucket);
      if (list === undefined) {
        list = createSortedList(compare);
        buckets.set(bucket, list);
      }
      insertIntoSortedList(list, slot);
    },
  };
};

type JobIndex = SlotIndex<JobSlot, StateJobInfo>;
type ChainIndex = SlotIndex<ChainSlot, ChainState>;

const jobKeys = {
  createdAt: (job: StateJobInfo) => job.createdAt.getTime(),
  scheduledAt: (job: StateJobInfo) => job.scheduledAt.getTime(),
  attemptAt: (job: StateJobInfo) => job.attemptAt!.getTime(),
  completedAt: (job: StateJobInfo) => job.completedAt!.getTime(),
};

const chainKeys = {
  createdAt: (chain: ChainState) => chain.info.createdAt.getTime(),
  completedAt: (chain: ChainState) => chain.info.completedAt!.getTime(),
};

const paginateByTimestamp = <T extends { id: string }>(
  list: SortedList<T> | undefined,
  keyOf: (item: T) => number,
  {
    sortKey,
    from,
    to,
    orderDirection,
    page,
  }: {
    sortKey: string;
    from?: Date;
    to?: Date;
    orderDirection: OrderDirection;
    page: PageParams;
  },
): Page<T> => {
  if (list === undefined) return { items: [], nextCursor: null };
  const cursor = page.cursor ? decodeTimestampWithIdCursor(page.cursor, sortKey) : undefined;
  const cursorMs = cursor ? Date.parse(cursor.value) : 0;
  const fromMs = from?.getTime();
  const toMs = to?.getTime();

  const items =
    orderDirection === "asc"
      ? takeFromSortedList(
          list,
          "asc",
          (item) => {
            const key = keyOf(item);
            if (fromMs !== undefined && key < fromMs) return true;
            return (
              cursor !== undefined && (key < cursorMs || (key === cursorMs && item.id <= cursor.id))
            );
          },
          toMs === undefined ? undefined : (item) => keyOf(item) > toMs,
          page.limit + 1,
        )
      : takeFromSortedList(
          list,
          "desc",
          (item) => {
            const key = keyOf(item);
            if (toMs !== undefined && key > toMs) return true;
            return (
              cursor !== undefined && (key > cursorMs || (key === cursorMs && item.id >= cursor.id))
            );
          },
          fromMs === undefined ? undefined : (item) => keyOf(item) < fromMs,
          page.limit + 1,
        );

  const hasMore = items.length > page.limit;
  if (hasMore) items.pop();
  const lastItem = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && lastItem !== undefined
        ? encodeCursor({
            type: "timestampWithId",
            sortKey,
            value: new Date(keyOf(lastItem)).toISOString(),
            id: lastItem.id,
          })
        : null,
  };
};

const transactionSymbol: unique symbol = Symbol("queuert.inProcess.transaction");

type InProcessTransaction = { journal: UndoEntry[]; open: boolean; txHooks: TxHooks };

/** Transaction context for the in-process state adapter. */
export type InProcessContext = { readonly [transactionSymbol]: InProcessTransaction };

const openTransactionOf = (
  txCtx: Partial<InProcessContext> | undefined,
): InProcessTransaction | undefined => {
  const transaction = txCtx?.[transactionSymbol];
  return transaction?.open === true ? transaction : undefined;
};

export const requireTxHooks = (txCtx: Partial<InProcessContext>): TxHooks => {
  const transaction = txCtx[transactionSymbol];
  if (transaction === undefined) {
    throw new Error(
      "The context has no in-process transaction: open it with the state adapter's withTransaction",
    );
  }
  return transaction.txHooks;
};

/** @internal Options of `createInProcessStateAdapter` and `createSyncInProcessStateAdapter`. */
export type InProcessStateAdapterOptions = {
  /**
   * Function to generate new job IDs. Must return unique values — collisions
   * are a hard error.
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
   * `BlockerLimitExceededError` before any state is written.
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
};

type InProcessMethods = Omit<
  StateAdapterOperations<InProcessContext, string, string, "sync">,
  "withTransaction" | "onTransactionCommit" | "onTransactionRollback"
>;

export const createInProcessState = (
  options: InProcessStateAdapterOptions,
): {
  methods: InProcessMethods;
  beginTransaction: (txHooks: TxHooks) => InProcessContext;
  rollbackTransaction: (txCtx: InProcessContext) => void;
  endTransaction: (txCtx: InProcessContext) => void;
  close: () => void;
} => {
  const config = resolveStateAdapterConfig(options);
  const { countCap } = config;
  const closed = createLatch("StateAdapter is closed");

  const jobs = new Map<string, JobSlot>();
  const chains = new Map<string, ChainSlot>();
  const workers = new Map<string, WorkerRow>();
  const chainsByDeduplicationKey = new Map<string, Set<ChainSlot>>();
  const jobCounts = new Map<string, JobCounts>();
  const chainCounts = new Map<string, ChainCounts>();
  let nextSeq = 0;

  const claimIndex = createSlotIndex<JobSlot, StateJobInfo>({
    bucketOf: (job) => (job.status === "pending" ? job.typeName : undefined),
    keyOf: jobKeys.scheduledAt,
    tie: (a, b) => a.seq - b.seq,
    slots: [],
  });
  const workerJobIndex = createSlotIndex<JobSlot, StateJobInfo>({
    bucketOf: (job) => (job.status === "running" ? (job.attemptBy ?? undefined) : undefined),
    keyOf: jobKeys.attemptAt,
    tie: compareIds,
    slots: [],
  });
  const jobIndexes: JobIndex[] = [claimIndex, workerJobIndex];
  const chainIndexes: ChainIndex[] = [];
  const jobListIndexes = new Map<string, JobIndex>();
  const chainListIndexes = new Map<string, ChainIndex>();

  const jobListIndex = (
    status: StateJobStatus | undefined,
    orderBy: keyof typeof jobKeys,
  ): JobIndex => {
    const name = `${status}:${orderBy}`;
    let index = jobListIndexes.get(name);
    if (index === undefined) {
      index = createSlotIndex<JobSlot, StateJobInfo>({
        bucketOf:
          status === undefined
            ? (job) => job.typeName
            : (job) => (job.status === status ? job.typeName : undefined),
        keyOf: jobKeys[orderBy],
        tie: compareIds,
        slots: jobs.values(),
      });
      jobListIndexes.set(name, index);
      jobIndexes.push(index);
    }
    return index;
  };

  const chainListIndex = (
    status: StateChainStatus | undefined,
    orderBy: keyof typeof chainKeys,
    independent: boolean | undefined,
  ): ChainIndex => {
    const name = `${status}:${orderBy}:${independent}`;
    let index = chainListIndexes.get(name);
    if (index === undefined) {
      index = createSlotIndex<ChainSlot, ChainState>({
        bucketOf: (chain) =>
          (status === undefined || chain.info.status === status) &&
          (independent === undefined || chain.blocking !== independent)
            ? chain.info.typeName
            : undefined,
        keyOf: chainKeys[orderBy],
        tie: compareIds,
        slots: chains.values(),
      });
      chainListIndexes.set(name, index);
      chainIndexes.push(index);
    }
    return index;
  };

  const applyJob = (slot: JobSlot, next: StateJobInfo | undefined): void => {
    const prev = slot.state;
    if (prev !== undefined) {
      for (const index of jobIndexes) {
        if (next === undefined || index.moves(prev, next)) index.remove(slot, prev);
      }
      jobCounts.get(prev.typeName)![prev.status]--;
    }
    slot.state = next;
    if (next !== undefined) {
      for (const index of jobIndexes) {
        if (prev === undefined || index.moves(prev, next)) index.insert(slot, next);
      }
      let counts = jobCounts.get(next.typeName);
      if (counts === undefined) {
        counts = { blocked: 0, pending: 0, running: 0, completed: 0 };
        jobCounts.set(next.typeName, counts);
      }
      counts[next.status]++;
    }
    if (prev === undefined && next !== undefined) {
      jobs.set(slot.id, slot);
      slot.chain.jobs[next.chainIndex] = slot;
    } else if (prev !== undefined && next === undefined) {
      jobs.delete(slot.id);
      const chainJobs = slot.chain.jobs;
      chainJobs[prev.chainIndex] = undefined;
      while (chainJobs.length > 0 && chainJobs[chainJobs.length - 1] === undefined) chainJobs.pop();
    }
  };

  const applyChain = (slot: ChainSlot, next: ChainState | undefined): void => {
    const prev = slot.state;
    if (prev !== undefined) {
      for (const index of chainIndexes) {
        if (next === undefined || index.moves(prev, next)) index.remove(slot, prev);
      }
      chainCounts.get(prev.info.typeName)![prev.info.status]--;
    }
    slot.state = next;
    if (next !== undefined) {
      for (const index of chainIndexes) {
        if (prev === undefined || index.moves(prev, next)) index.insert(slot, next);
      }
      let counts = chainCounts.get(next.info.typeName);
      if (counts === undefined) {
        counts = { running: 0, completed: 0 };
        chainCounts.set(next.info.typeName, counts);
      }
      counts[next.info.status]++;
    }
    if (prev === undefined && next !== undefined) {
      chains.set(slot.id, slot);
      if (slot.deduplicationIndexKey !== undefined) {
        let matches = chainsByDeduplicationKey.get(slot.deduplicationIndexKey);
        if (matches === undefined) {
          matches = new Set();
          chainsByDeduplicationKey.set(slot.deduplicationIndexKey, matches);
        }
        matches.add(slot);
      }
    } else if (prev !== undefined && next === undefined) {
      chains.delete(slot.id);
      if (slot.deduplicationIndexKey !== undefined) {
        const matches = chainsByDeduplicationKey.get(slot.deduplicationIndexKey)!;
        matches.delete(slot);
        if (matches.size === 0) chainsByDeduplicationKey.delete(slot.deduplicationIndexKey);
      }
    }
  };

  const compareDependents = (a: JobSlot, b: JobSlot): number =>
    a.state!.createdAt.getTime() - b.state!.createdAt.getTime() || compareIds(a, b);

  const setBlocking = (chain: ChainSlot, blocking: boolean): void => {
    const state = chain.state;
    if (state !== undefined && state.blocking !== blocking) {
      applyChain(chain, { info: state.info, blocking });
    }
  };

  const applyBlockers = (slot: JobSlot, next: readonly BlockerRow[]): void => {
    const prevChains = new Set(slot.blockers.map((row) => row.chain));
    const nextChains = new Set(next.map((row) => row.chain));
    slot.blockers = next;
    for (const chain of prevChains) {
      if (nextChains.has(chain)) continue;
      deleteFromSortedList(chain.dependents!, slot);
      if (chain.dependents!.size === 0) {
        chain.dependents = undefined;
        setBlocking(chain, false);
      }
    }
    for (const chain of nextChains) {
      if (prevChains.has(chain)) continue;
      if (chain.dependents === undefined) {
        chain.dependents = createSortedList(compareDependents);
        setBlocking(chain, true);
      }
      insertIntoSortedList(chain.dependents, slot);
    }
  };

  const applyWorker = (id: string, next: WorkerRow | undefined): void => {
    if (next === undefined) workers.delete(id);
    else workers.set(id, next);
  };

  const setJob = (journal: UndoEntry[], slot: JobSlot, next: StateJobInfo | undefined): void => {
    journal.push({ kind: "job", slot, prev: slot.state });
    applyJob(slot, next);
  };

  const setChain = (journal: UndoEntry[], slot: ChainSlot, next: ChainState | undefined): void => {
    journal.push({ kind: "chain", slot, prev: slot.state });
    applyChain(slot, next);
  };

  const setBlockers = (journal: UndoEntry[], slot: JobSlot, next: readonly BlockerRow[]): void => {
    journal.push({ kind: "blockers", slot, prev: slot.blockers });
    applyBlockers(slot, next);
  };

  const setWorker = (journal: UndoEntry[], id: string, next: WorkerRow | undefined): void => {
    journal.push({ kind: "worker", id, prev: workers.get(id) });
    applyWorker(id, next);
  };

  const undoTo = (journal: UndoEntry[], mark: number): void => {
    while (journal.length > mark) {
      const entry = journal.pop()!;
      if (entry.kind === "job") applyJob(entry.slot, entry.prev);
      else if (entry.kind === "chain") applyChain(entry.slot, entry.prev);
      else if (entry.kind === "blockers") applyBlockers(entry.slot, entry.prev);
      else applyWorker(entry.id, entry.prev);
    }
  };

  const autocommitJournal: UndoEntry[] = [];

  const read = <T>(txCtx: InProcessContext | undefined, fn: () => T): T => {
    if (openTransactionOf(txCtx) === undefined) closed.throwIfTripped();
    return fn();
  };

  const write = <T>(txCtx: InProcessContext | undefined, fn: (journal: UndoEntry[]) => T): T => {
    const transaction = openTransactionOf(txCtx);
    if (transaction === undefined) {
      closed.throwIfTripped();
      try {
        return fn(autocommitJournal);
      } catch (error) {
        undoTo(autocommitJournal, 0);
        throw error;
      } finally {
        autocommitJournal.length = 0;
      }
    }
    const journal = transaction.journal;
    const mark = journal.length;
    try {
      return fn(journal);
    } catch (error) {
      undoTo(journal, mark);
      throw error;
    }
  };

  const createJobSlot = (chain: ChainSlot, id: string): JobSlot => ({
    id,
    seq: nextSeq++,
    chain,
    state: undefined,
    blockers: NO_BLOCKERS,
  });

  const newJobState = (params: {
    id: string;
    typeName: string;
    chainId: string;
    chainIndex: number;
    input: unknown;
    schedule: ScheduleOptions | undefined;
    traceContext: string | null | undefined;
    now: Date;
  }): StateJobInfo => ({
    id: params.id,
    typeName: params.typeName,
    chainId: params.chainId,
    chainIndex: params.chainIndex,
    status: "pending",
    createdAt: params.now,
    input: params.input,
    scheduledAt: resolveScheduledAt(params.schedule, params.now),
    completedAt: null,
    completedBy: null,
    continuedToId: null,
    output: null,
    attempt: 0,
    lastAttemptError: null,
    lastAttemptAt: null,
    attemptAt: null,
    attemptBy: null,
    attemptToken: null,
    traceContext: params.traceContext ?? null,
  });

  const jobView = (slot: JobSlot): StateJob => ({ ...slot.state!, chain: slot.chain.state!.info });

  const chainView = (slot: ChainSlot): StateChain => {
    const chainJobs = slot.jobs;
    return {
      ...slot.state!.info,
      head: chainJobs[0]!.state!,
      tail: chainJobs.length > 1 ? chainJobs[chainJobs.length - 1]!.state : undefined,
    };
  };

  const workerView = (worker: WorkerRow, nowMs: number): StateWorkerInfo => ({
    ...worker,
    typeNames: [...worker.typeNames],
    expired: !isLive(worker, nowMs),
  });

  const findDeduplicatedChain = (
    typeName: string,
    deduplication: DeduplicationOptions,
  ): ChainSlot | undefined => {
    if (!deduplication.key) return undefined;
    const matches = chainsByDeduplicationKey.get(`${typeName}\u0000${deduplication.key}`);
    if (matches === undefined) return undefined;
    let best: ChainSlot | undefined;
    for (const chain of matches) {
      const info = chain.state!.info;
      if (deduplication.scope === "running" && info.status !== "running") continue;
      if (best === undefined || info.createdAt > best.state!.info.createdAt) best = chain;
    }
    return best;
  };

  const methods: InProcessMethods = {
    config,

    isTransaction: (txCtx) => openTransactionOf(txCtx) !== undefined,

    getChains: ({ txCtx, chainIds }) =>
      read(txCtx, () =>
        chainIds.map((chainId) => {
          const chain = chains.get(chainId);
          return chain === undefined ? undefined : chainView(chain);
        }),
      ),

    getJobs: ({ txCtx, jobIds }) =>
      read(txCtx, () =>
        jobIds.map((jobId) => {
          const slot = jobs.get(jobId);
          return slot === undefined ? undefined : jobView(slot);
        }),
      ),

    getWorkers: ({ txCtx, workerIds }) =>
      read(txCtx, () => {
        const nowMs = Date.now();
        return workerIds.map((workerId) => {
          const worker = workers.get(workerId);
          return worker === undefined ? undefined : workerView(worker, nowMs);
        });
      }),

    createJobs: ({ txCtx, jobs: jobInputs }) =>
      write(txCtx, (journal) => {
        const now = new Date();
        return jobInputs.map(
          ({ typeName, id, input, schedule, deduplication, traceContext, chainTraceContext }) => {
            if (deduplication !== undefined) {
              const existing = findDeduplicatedChain(typeName, deduplication);
              if (existing !== undefined) return { ...chainView(existing), deduplicated: true };
            }
            if (jobs.has(id)) throw new Error(`Job id "${id}" already exists`);

            const chain: ChainSlot = {
              id,
              deduplicationIndexKey:
                deduplication?.key != null ? `${typeName}\u0000${deduplication.key}` : undefined,
              state: undefined,
              jobs: [],
              dependents: undefined,
            };
            const info: StateChainInfo = {
              id,
              typeName,
              status: "running",
              deduplicationKey: deduplication?.key ?? null,
              createdAt: now,
              completedAt: null,
              traceContext: chainTraceContext ?? null,
            };
            setChain(journal, chain, { info, blocking: false });
            const head = newJobState({
              id,
              typeName,
              chainId: id,
              chainIndex: 0,
              input,
              schedule,
              traceContext,
              now,
            });
            setJob(journal, createJobSlot(chain, id), head);
            return { ...info, head, tail: undefined, deduplicated: false };
          },
        );
      }),

    continueJobs: ({ txCtx, jobs: jobInputs }) =>
      write(txCtx, (journal) => {
        const now = new Date();
        const parents = jobInputs.map(({ continueFromId, attemptToken }) => {
          const slot = jobs.get(continueFromId);
          const state = slot?.state;
          return state === undefined ||
            state.status === "completed" ||
            !holdsAttempt(state, attemptToken)
            ? undefined
            : { slot: slot!, state };
        });

        return jobInputs.map(({ typeName, id, input, schedule, traceContext, workerId }, i) => {
          const parent = parents[i];
          if (parent === undefined) return undefined;
          const chain = parent.slot.chain;
          const chainIndex = parent.state.chainIndex + 1;
          if (chain.jobs[chainIndex] !== undefined) {
            throw new Error(`Chain "${chain.id}" already has a job at index ${chainIndex}`);
          }
          if (jobs.has(id)) throw new Error(`Job id "${id}" already exists`);

          const continuation = newJobState({
            id,
            typeName,
            chainId: chain.id,
            chainIndex,
            input,
            schedule,
            traceContext,
            now,
          });
          setJob(journal, createJobSlot(chain, id), continuation);
          const completed: StateJobInfo = {
            ...parent.state,
            status: "completed",
            completedAt: now,
            completedBy: workerId ?? null,
            continuedToId: id,
            output: null,
            lastAttemptError: null,
            attemptAt: null,
            attemptBy: null,
            attemptToken: null,
          };
          setJob(journal, parent.slot, completed);
          return { ...completed, chain: chain.state!.info, continuation };
        });
      }),

    completeJobs: ({ txCtx, jobs: jobInputs }) =>
      write(txCtx, (journal) => {
        const now = new Date();
        return jobInputs.map(({ jobId, output, attemptToken, workerId }) => {
          const slot = jobs.get(jobId);
          const state = slot?.state;
          if (
            state === undefined ||
            state.status === "completed" ||
            !holdsAttempt(state, attemptToken)
          ) {
            return undefined;
          }
          const completed: StateJobInfo = {
            ...state,
            status: "completed",
            completedAt: now,
            completedBy: workerId ?? null,
            output: output ?? null,
            lastAttemptError: null,
            attemptAt: null,
            attemptBy: null,
            attemptToken: null,
          };
          setJob(journal, slot!, completed);
          const chain = slot!.chain;
          const chainState = chain.state!;
          if (chainState.info.status !== "completed") {
            setChain(journal, chain, {
              info: { ...chainState.info, status: "completed", completedAt: now },
              blocking: chainState.blocking,
            });
          }
          return { ...completed, chain: chain.state!.info };
        });
      }),

    rescheduleJobs: ({ txCtx, jobs: jobInputs }) =>
      write(txCtx, (journal) => {
        const now = new Date();
        const resultById = new Map<string, StateJob | undefined>();
        return jobInputs.map(({ jobId, schedule, error, attemptToken }) => {
          if (resultById.has(jobId)) return resultById.get(jobId);
          const slot = jobs.get(jobId);
          const state = slot?.state;
          let result: StateJob | undefined;
          if (
            state !== undefined &&
            state.status !== "completed" &&
            holdsAttempt(state, attemptToken)
          ) {
            const rescheduled: StateJobInfo =
              state.status === "running"
                ? {
                    ...state,
                    status: "pending",
                    scheduledAt: resolveScheduledAt(schedule, now),
                    lastAttemptAt: now,
                    lastAttemptError: error ?? null,
                    attemptAt: null,
                    attemptBy: null,
                    attemptToken: null,
                  }
                : {
                    ...state,
                    scheduledAt: resolveScheduledAt(schedule, now),
                    attemptAt: null,
                    attemptBy: null,
                    attemptToken: null,
                  };
            setJob(journal, slot!, rescheduled);
            result = jobView(slot!);
          }
          resultById.set(jobId, result);
          return result;
        });
      }),

    deleteChains: ({ txCtx, chainIds }) =>
      write(txCtx, (journal) => {
        const uniqueChainIds = new Set(chainIds);
        const externalBlockers = new Map<string, StateBlockedJob[]>();
        for (const chainId of uniqueChainIds) {
          const dependents = chains.get(chainId)?.dependents;
          if (dependents === undefined) continue;
          for (const dependent of sortedListToArray(dependents)) {
            if (uniqueChainIds.has(dependent.chain.id)) continue;
            let references = externalBlockers.get(chainId);
            if (references === undefined) {
              references = [];
              externalBlockers.set(chainId, references);
            }
            for (const row of dependent.blockers) {
              if (row.blockedByChainId !== chainId) continue;
              references.push({
                jobId: dependent.id,
                blockedByChainId: chainId,
                index: row.index,
                traceContext: row.traceContext,
                job: dependent.state!,
              });
            }
          }
        }
        if (externalBlockers.size > 0) {
          return chainIds.map((chainId) => externalBlockers.get(chainId));
        }

        const results = chainIds.map((chainId) => {
          const chain = chains.get(chainId);
          return chain === undefined ? undefined : chainView(chain);
        });

        const deleted: ChainSlot[] = [];
        for (const chainId of uniqueChainIds) {
          const chain = chains.get(chainId);
          if (chain !== undefined) deleted.push(chain);
        }
        for (const chain of deleted) {
          for (const slot of chain.jobs) {
            if (slot !== undefined && slot.blockers.length > 0) {
              setBlockers(journal, slot, NO_BLOCKERS);
            }
          }
        }
        for (const chain of deleted) {
          for (let index = chain.jobs.length - 1; index >= 0; index--) {
            const slot = chain.jobs[index];
            if (slot !== undefined) setJob(journal, slot, undefined);
          }
          setChain(journal, chain, undefined);
        }
        return results;
      }),

    startJobAttempts: ({ txCtx, typeNames, workerId, workerToken, limit }) =>
      write(txCtx, (journal) => {
        const acquired: (StateJob & { hasBlockers: boolean })[] = [];
        const now = new Date();
        const nowMs = now.getTime();
        const worker = workers.get(workerId);
        if (worker === undefined || worker.token !== workerToken || !isLive(worker, nowMs)) {
          return acquired;
        }
        const queues: SortedList<JobSlot>[] = [];
        for (const typeName of typeNames) {
          const queue = claimIndex.buckets.get(typeName);
          if (queue !== undefined) queues.push(queue);
        }

        while (acquired.length < limit) {
          let best: JobSlot | undefined;
          for (const queue of queues) {
            const candidate = firstOfSortedList(queue);
            if (candidate === undefined || candidate.state!.scheduledAt.getTime() > nowMs) continue;
            if (best === undefined || claimIndex.compare(candidate, best) < 0) best = candidate;
          }
          if (best === undefined) break;

          const state = best.state!;
          const running: StateJobInfo = {
            ...state,
            status: "running",
            attempt: state.attempt + 1,
            attemptAt: now,
            attemptBy: workerId,
            attemptToken: crypto.randomUUID(),
          };
          setJob(journal, best, running);
          acquired.push({
            ...running,
            chain: best.chain.state!.info,
            hasBlockers: best.blockers.length > 0,
          });
        }
        return acquired;
      }),

    getStartAttemptDelayMs: ({ txCtx, typeNames }) =>
      read(txCtx, () => {
        let earliest: number | undefined;
        for (const typeName of typeNames) {
          const queue = claimIndex.buckets.get(typeName);
          const first = queue === undefined ? undefined : firstOfSortedList(queue);
          if (first === undefined) continue;
          const scheduledAt = first.state!.scheduledAt.getTime();
          if (earliest === undefined || scheduledAt < earliest) earliest = scheduledAt;
        }
        return earliest === undefined ? null : Math.max(0, earliest - Date.now());
      }),

    addJobsBlockers: ({ txCtx, jobBlockers }) =>
      write(txCtx, (journal) => {
        const missingJobIds = jobBlockers
          .map(({ jobId }) => jobId)
          .filter((jobId) => !jobs.has(jobId));
        if (missingJobIds.length > 0) {
          throw new Error(
            `addJobsBlockers requires existing jobs; not found: ${missingJobIds.join(", ")}`,
          );
        }

        return jobBlockers.map(({ jobId, blockedByChainIds, blockerTraceContexts }) => {
          const slot = jobs.get(jobId)!;
          const rows = [...slot.blockers];
          const blockers = blockedByChainIds.map((blockedByChainId, index) => {
            const chain = chains.get(blockedByChainId);
            if (chain === undefined) return undefined;
            const row: BlockerRow = {
              blockedByChainId,
              index,
              traceContext: blockerTraceContexts?.[index] ?? null,
              chain,
            };
            const existing = rows.findIndex(
              (other) => other.blockedByChainId === blockedByChainId && other.index === index,
            );
            if (existing === -1) rows.push(row);
            else rows[existing] = row;
            return chain.state!.info;
          });
          if (rows.length > 0) {
            setBlockers(
              journal,
              slot,
              rows.sort((a, b) => a.index - b.index),
            );
          }

          const state = slot.state!;
          if (state.status === "pending" && blockers.some((info) => info?.status === "running")) {
            setJob(journal, slot, { ...state, status: "blocked" });
          }
          return { ...jobView(slot), blockers };
        });
      }),

    getJobBlockers: ({ txCtx, jobId }) =>
      read(txCtx, () => {
        const slot = jobs.get(jobId);
        if (slot === undefined) return [];
        const result: StateChain[] = [];
        for (const row of slot.blockers) {
          if (row.chain.state !== undefined) result.push(chainView(row.chain));
        }
        return result;
      }),

    unblockJobs: ({ txCtx, blockedByChainId }) =>
      write(txCtx, (journal) => {
        const dependents = chains.get(blockedByChainId)?.dependents;
        if (dependents === undefined) return [];
        const now = new Date();
        const result: StateDependentJob[] = [];
        for (const slot of sortedListToArray(dependents)) {
          const state = slot.state!;
          if (
            state.status === "blocked" &&
            slot.blockers.every((row) => row.chain.state?.info.status === "completed")
          ) {
            setJob(journal, slot, {
              ...state,
              status: "pending",
              scheduledAt: state.scheduledAt.getTime() > now.getTime() ? state.scheduledAt : now,
            });
          }
          const job = jobView(slot);
          for (const row of slot.blockers) {
            if (row.blockedByChainId !== blockedByChainId) continue;
            result.push({
              jobId: slot.id,
              blockedByChainId,
              index: row.index,
              traceContext: row.traceContext,
              job,
            });
          }
        }
        return result.sort(
          (a, b) => compareIds({ id: a.jobId }, { id: b.jobId }) || a.index - b.index,
        );
      }),

    startWorker: ({ txCtx, workerId, typeNames, concurrency, leaseMs }) =>
      write(txCtx, (journal) => {
        if (workers.has(workerId)) throw new Error(`Worker id "${workerId}" already exists`);
        const nowMs = Date.now();
        const worker: WorkerRow = {
          id: workerId,
          typeNames: [...typeNames],
          concurrency,
          startedAt: new Date(nowMs),
          leaseUntil: new Date(nowMs + leaseMs),
          token: crypto.randomUUID(),
        };
        setWorker(journal, workerId, worker);
        return workerView(worker, nowMs);
      }),

    extendWorkerLease: ({ txCtx, workerId, workerToken, leaseMs }) =>
      write(txCtx, (journal) => {
        const nowMs = Date.now();
        const worker = workers.get(workerId);
        if (worker === undefined || worker.token !== workerToken || !isLive(worker, nowMs)) {
          return undefined;
        }
        const renewed: WorkerRow = { ...worker, leaseUntil: new Date(nowMs + leaseMs) };
        setWorker(journal, workerId, renewed);
        return workerView(renewed, nowMs);
      }),

    stopWorker: ({ txCtx, workerId, workerToken }) =>
      write(txCtx, (journal) => {
        const worker = workers.get(workerId);
        if (worker === undefined || worker.token !== workerToken) return undefined;
        setWorker(journal, workerId, undefined);
        return workerView(worker, Date.now());
      }),

    getChainTypeNames: ({ txCtx }) =>
      read(txCtx, () =>
        [...chainCounts]
          .filter(([, counts]) => counts.running + counts.completed > 0)
          .map(([typeName]) => typeName),
      ),

    getJobTypeNames: ({ txCtx }) =>
      read(txCtx, () =>
        [...jobCounts]
          .filter(
            ([, counts]) => counts.blocked + counts.pending + counts.running + counts.completed > 0,
          )
          .map(([typeName]) => typeName),
      ),

    countChainsByTypeName: ({ txCtx, typeNames }) =>
      read(txCtx, () =>
        typeNames.map((typeName) => {
          const counts = chainCounts.get(typeName);
          return {
            running: capCount(counts?.running ?? 0, countCap),
            completed: capCount(counts?.completed ?? 0, countCap),
          };
        }),
      ),

    countJobsByTypeName: ({ txCtx, typeNames }) =>
      read(txCtx, () =>
        typeNames.map((typeName) => {
          const counts = jobCounts.get(typeName);
          return {
            blocked: capCount(counts?.blocked ?? 0, countCap),
            pending: capCount(counts?.pending ?? 0, countCap),
            running: capCount(counts?.running ?? 0, countCap),
            completed: capCount(counts?.completed ?? 0, countCap),
          };
        }),
      ),

    countWorkers: ({ txCtx }) =>
      read(txCtx, () => {
        const nowMs = Date.now();
        let live = 0;
        for (const worker of workers.values()) if (isLive(worker, nowMs)) live++;
        return { live, expired: workers.size - live };
      }),

    countWorkersByTypeName: ({ txCtx, typeNames }) =>
      read(txCtx, () => {
        const nowMs = Date.now();
        return typeNames.map((typeName) => {
          let live = 0;
          let expired = 0;
          for (const worker of workers.values()) {
            if (!worker.typeNames.includes(typeName)) continue;
            if (isLive(worker, nowMs)) live++;
            else expired++;
          }
          return { live, expired };
        });
      }),

    countRunningJobsByWorkerId: ({ txCtx, workerIds }) =>
      read(txCtx, () =>
        workerIds.map((workerId) => workerJobIndex.buckets.get(workerId)?.size ?? 0),
      ),

    listChains: ({
      txCtx,
      typeName,
      independent,
      from,
      to,
      status,
      orderBy,
      orderDirection,
      page,
    }) =>
      read(txCtx, () => {
        const keyOf = chainKeys[orderBy];
        const chainPage = paginateByTimestamp(
          chainListIndex(status, orderBy, independent).buckets.get(typeName),
          (chain) => keyOf(chain.state!),
          { sortKey: orderBy, from, to, orderDirection, page },
        );
        return { items: chainPage.items.map(chainView), nextCursor: chainPage.nextCursor };
      }),

    listJobs: ({ txCtx, typeName, from, to, status, orderBy, orderDirection, page }) =>
      read(txCtx, () => {
        const keyOf = jobKeys[orderBy];
        const jobPage = paginateByTimestamp(
          jobListIndex(status, orderBy).buckets.get(typeName),
          (slot) => keyOf(slot.state!),
          { sortKey: orderBy, from, to, orderDirection, page },
        );
        return { items: jobPage.items.map(jobView), nextCursor: jobPage.nextCursor };
      }),

    listChainJobs: ({ txCtx, chainId, orderDirection, page }) =>
      read(txCtx, () => {
        const chainJobs = chains.get(chainId)?.jobs ?? [];
        const step = orderDirection === "asc" ? 1 : -1;
        let start = orderDirection === "asc" ? 0 : chainJobs.length - 1;
        if (page.cursor) {
          const cursorSlot = jobs.get(decodeIdCursor(page.cursor).id);
          start =
            cursorSlot?.chain.id === chainId
              ? cursorSlot.state!.chainIndex + step
              : chainJobs.length;
        }
        const items: StateJob[] = [];
        let position = start;
        for (; position >= 0 && position < chainJobs.length; position += step) {
          if (items.length === page.limit) break;
          const slot = chainJobs[position];
          if (slot !== undefined) items.push(jobView(slot));
        }
        const hasMore = position >= 0 && position < chainJobs.length;
        const lastItem = items[items.length - 1];
        return {
          items,
          nextCursor:
            hasMore && lastItem !== undefined
              ? encodeCursor({ type: "id", id: lastItem.id })
              : null,
        };
      }),

    listBlockedJobs: ({ txCtx, chainId, orderDirection, page }) =>
      read(txCtx, () => {
        const jobPage = paginateByTimestamp(
          chains.get(chainId)?.dependents,
          (slot) => slot.state!.createdAt.getTime(),
          { sortKey: "createdAt", orderDirection, page },
        );
        return { items: jobPage.items.map(jobView), nextCursor: jobPage.nextCursor };
      }),

    listWorkers: ({ txCtx, typeName, status, orderDirection, page }) =>
      read(txCtx, () => {
        const nowMs = Date.now();
        const keyOf = (worker: WorkerRow) => worker.startedAt.getTime();
        const compare = (a: WorkerRow, b: WorkerRow) => keyOf(a) - keyOf(b) || compareIds(a, b);
        const matched = [...workers.values()].filter(
          (worker) =>
            (typeName === undefined || worker.typeNames.includes(typeName)) &&
            (status === undefined || isLive(worker, nowMs) === (status === "live")),
        );
        const workerPage = paginateByTimestamp(
          createSortedList(compare, matched.sort(compare)),
          keyOf,
          { sortKey: "startedAt", orderDirection, page },
        );
        return {
          items: workerPage.items.map((worker) => workerView(worker, nowMs)),
          nextCursor: workerPage.nextCursor,
        };
      }),

    listWorkerJobs: ({ txCtx, workerId, orderDirection, page }) =>
      read(txCtx, () => {
        const jobPage = paginateByTimestamp(
          workerJobIndex.buckets.get(workerId),
          (slot) => slot.state!.attemptAt!.getTime(),
          { sortKey: "attemptAt", orderDirection, page },
        );
        return { items: jobPage.items.map(jobView), nextCursor: jobPage.nextCursor };
      }),
  };

  const beginTransaction = (txHooks: TxHooks): InProcessContext => {
    closed.throwIfTripped();
    return { [transactionSymbol]: { journal: [], open: true, txHooks } };
  };

  const rollbackTransaction = (txCtx: InProcessContext): void => {
    undoTo(txCtx[transactionSymbol].journal, 0);
  };

  const endTransaction = (txCtx: InProcessContext): void => {
    txCtx[transactionSymbol].open = false;
  };

  const close = (): void => {
    if (!closed.trip()) return;
    jobs.clear();
    chains.clear();
    workers.clear();
    chainsByDeduplicationKey.clear();
    jobCounts.clear();
    chainCounts.clear();
    for (const index of [...jobIndexes, ...chainIndexes]) index.buckets.clear();
  };

  return { methods, beginTransaction, rollbackTransaction, endTransaction, close };
};
