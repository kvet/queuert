import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { createAsyncRwLock } from "../helpers/async-rw-lock.js";
import { type OrderDirection, type Page, type PageParams } from "../pagination.js";
import { decodeIdCursor, decodeTimestampWithIdCursor, encodeCursor } from "./cursor.js";
import { createIdValidator } from "./id-validator.js";
import {
  type StateAdapter,
  type StateAttemptFence,
  type StateBlockedJob,
  type StateDependentJob,
  type StateChain,
  type StateChainInfo,
  type StateChainStatus,
  type StateCount,
  type StateJob,
  type StateJobInfo,
} from "./state-adapter.js";

type DbJob = StateJobInfo & {
  chainStatus: StateChainStatus | null;
  chainCompletedAt: Date | null;
  deduplicationKey: string | null;
  chainTraceContext: string | null;
};
type Comparator<T> = (a: T, b: T) => number;
type BlockerEntry = { blockedByChainId: string; index: number; traceContext: string | null };
type JournalEntry =
  | { kind: "job"; prev: DbJob | undefined; next: DbJob | undefined }
  | {
      kind: "blocker";
      jobId: string;
      key: string;
      prev: BlockerEntry | undefined;
      next: BlockerEntry | undefined;
    };

const blockerKey = (blockedByChainId: string, index: number): string =>
  `${blockedByChainId}\u0000${index}`;

// ── Status helpers ──────────────────────────────────────────────────

const isCompleted = (job: DbJob): boolean => job.status === "completed";
const isRunning = (job: DbJob): boolean => job.status === "running";
const isPending = (job: DbJob): boolean => job.status === "pending";
const matchesFence = (job: DbJob, fence: StateAttemptFence | undefined): boolean =>
  fence === undefined ||
  (isRunning(job) && job.attempt === fence.attempt && job.attemptBy === fence.workerId);

const matchesChainStatus = (headJob: DbJob, status?: string): boolean =>
  status === undefined || headJob.chainStatus === status;

const matchesJobStatus = (job: DbJob, status?: string): boolean =>
  status === undefined || job.status === status;

const matchesDateRange = (value: Date | null | undefined, from?: Date, to?: Date): boolean => {
  if (!from && !to) return true;
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
};

const matchesTypeNameFilter = (job: DbJob, typeName: string): boolean => job.typeName === typeName;

const COUNT_CAP = 10_000;

const cappedCount = (count: number): StateCount => ({
  count: Math.min(count, COUNT_CAP),
  hasMore: count > COUNT_CAP,
});

// ── Pagination helpers ──────────────────────────────────────────────

type PaginateItem = DbJob | [DbJob, DbJob | undefined];

const paginateItemId = (item: PaginateItem): string => (Array.isArray(item) ? item[0].id : item.id);

const paginateByTimestamp = <T extends PaginateItem>(
  items: T[],
  page: PageParams,
  orderDirection: OrderDirection,
  sortKey: string,
  getTimestamp: (item: T) => Date,
): Page<T> => {
  const directionSign = orderDirection === "desc" ? -1 : 1;
  const sorted = items.toSorted((a, b) => {
    const difference = getTimestamp(a).getTime() - getTimestamp(b).getTime();
    if (difference !== 0) return difference * directionSign;
    const idA = paginateItemId(a);
    const idB = paginateItemId(b);
    return idA < idB ? -directionSign : idA > idB ? directionSign : 0;
  });

  let startIndex = 0;
  if (page.cursor) {
    const cursor = decodeTimestampWithIdCursor(page.cursor, sortKey);
    startIndex = sorted.findIndex((item) => {
      const value = getTimestamp(item).toISOString();
      const id = paginateItemId(item);
      if (orderDirection === "desc") {
        return value < cursor.value || (value === cursor.value && id < cursor.id);
      }
      return value > cursor.value || (value === cursor.value && id > cursor.id);
    });
    if (startIndex === -1) startIndex = sorted.length;
  }

  const pageItems = sorted.slice(startIndex, startIndex + page.limit);
  const hasMore = startIndex + page.limit < sorted.length;
  const lastItem = pageItems[pageItems.length - 1];

  return {
    items: pageItems,
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({
            type: "timestampWithId",
            sortKey,
            value: getTimestamp(lastItem).toISOString(),
            id: paginateItemId(lastItem),
          })
        : null,
  };
};

const jobTimestampGetters: Record<string, (job: DbJob) => Date> = {
  createdAt: (job) => job.createdAt,
  completedAt: (job) => job.completedAt!,
  scheduledAt: (job) => job.scheduledAt,
  attemptAt: (job) => job.attemptAt!,
  attemptUntil: (job) => job.attemptUntil ?? job.attemptAt!,
};

const chainTimestampGetters: Record<string, (pair: [DbJob, DbJob | undefined]) => Date> = {
  createdAt: ([head]) => head.createdAt,
  completedAt: ([head]) => head.chainCompletedAt!,
};

const paginateByChainIndex = (
  items: DbJob[],
  jobsById: Map<string, DbJob>,
  page: PageParams,
  orderDirection: OrderDirection,
): Page<DbJob> => {
  const directionSign = orderDirection === "asc" ? 1 : -1;
  const sorted = items.toSorted((a, b) => {
    const difference = a.chainIndex - b.chainIndex;
    if (difference !== 0) return difference * directionSign;
    return a.id < b.id ? -directionSign : a.id > b.id ? directionSign : 0;
  });

  let startIndex = 0;
  if (page.cursor) {
    const cursor = decodeIdCursor(page.cursor);
    const cursorJob = jobsById.get(cursor.id);
    if (!cursorJob) {
      startIndex = sorted.length;
    } else {
      startIndex = sorted.findIndex((item) => {
        if (orderDirection === "asc") return item.chainIndex > cursorJob.chainIndex;
        return item.chainIndex < cursorJob.chainIndex;
      });
      if (startIndex === -1) startIndex = sorted.length;
    }
  }

  const pageItems = sorted.slice(startIndex, startIndex + page.limit);
  const hasMore = startIndex + page.limit < sorted.length;
  const lastItem = pageItems[pageItems.length - 1];

  return {
    items: pageItems,
    nextCursor: hasMore && lastItem ? encodeCursor({ type: "id", id: lastItem.id }) : null,
  };
};

// ── SortedSet ───────────────────────────────────────────────────────

class SortedSet<T> {
  private readonly items: T[] = [];
  constructor(private readonly cmp: Comparator<T>) {}

  get size(): number {
    return this.items.length;
  }

  first(): T | undefined {
    return this.items[0];
  }

  at(i: number): T | undefined {
    return this.items[i];
  }

  insert(item: T): void {
    const i = this.lowerBound(item);
    this.items.splice(i, 0, item);
  }

  delete(item: T): void {
    const i = this.lowerBound(item);
    if (i < this.items.length && this.cmp(this.items[i], item) === 0) {
      this.items.splice(i, 1);
    }
  }

  clear(): void {
    this.items.length = 0;
  }

  *iterate(direction: "asc" | "desc"): IterableIterator<T> {
    if (direction === "asc") {
      for (let i = 0; i < this.items.length; i++) yield this.items[i];
    } else {
      for (let i = this.items.length - 1; i >= 0; i--) yield this.items[i];
    }
  }

  private lowerBound(item: T): number {
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cmp(this.items[mid], item) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

// ── JobIndex ────────────────────────────────────────────────────────

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const clampToFloor = (requested: Date, now: Date): Date =>
  requested.getTime() > now.getTime() ? requested : now;

const buildDbJob = (params: {
  id: string;
  typeName: string;
  chainId: string;
  chainIndex: number;
  deduplicationKey: string | null;
  input: unknown;
  schedule?: ScheduleOptions;
  chainTraceContext?: string | null;
  traceContext?: string | null;
}): DbJob => {
  const now = new Date();
  const requestedScheduledAt =
    params.schedule?.at ??
    (params.schedule?.afterMs ? new Date(now.getTime() + params.schedule.afterMs) : now);
  return {
    id: params.id,
    typeName: params.typeName,
    chainIndex: params.chainIndex,
    chainStatus: params.chainIndex === 0 ? "running" : null,
    chainCompletedAt: null,
    continuedToId: null,
    input: params.input,
    output: null,
    chainId: params.chainId,
    status: "pending",
    createdAt: now,
    scheduledAt: clampToFloor(requestedScheduledAt, now),
    completedAt: null,
    completedBy: null,
    attempt: 0,
    lastAttemptError: null,
    lastAttemptAt: null,
    attemptBy: null,
    attemptUntil: null,
    attemptAt: null,
    deduplicationKey: params.deduplicationKey,
    chainTraceContext: params.chainTraceContext ?? null,
    traceContext: params.traceContext ?? null,
  };
};

class JobIndex {
  readonly jobs = new Map<string, DbJob>();
  readonly pendingByType = new Map<string, SortedSet<DbJob>>();
  readonly runningByType = new Map<string, SortedSet<DbJob>>();
  readonly jobsByChain = new Map<string, Map<number, DbJob>>();
  readonly tailByChain = new Map<string, DbJob>();
  readonly headJobsByDeduplicationKey = new Map<string, Set<DbJob>>();
  readonly jobBlockers = new Map<string, Map<string, BlockerEntry>>();
  readonly blockedByChain = new Map<string, Set<string>>();
  readonly seqByJobId = new Map<string, number>();
  readonly headJobsByCreatedAt: SortedSet<DbJob>;

  readonly cmpScheduledAt: Comparator<DbJob>;
  private readonly cmpAttemptUntil: Comparator<DbJob>;
  private nextSeq = 0;

  constructor() {
    const seq = (job: DbJob): number => this.seqByJobId.get(job.id) ?? 0;

    this.cmpScheduledAt = (a, b) => {
      const d = a.scheduledAt.getTime() - b.scheduledAt.getTime();
      if (d !== 0) return d;
      const s = seq(a) - seq(b);
      return s !== 0 ? s : compareStrings(a.id, b.id);
    };

    this.cmpAttemptUntil = (a, b) => {
      const ax = a.attemptUntil ? a.attemptUntil.getTime() : Infinity;
      const bx = b.attemptUntil ? b.attemptUntil.getTime() : Infinity;
      const d = ax - bx;
      if (d !== 0) return d;
      const s = seq(a) - seq(b);
      return s !== 0 ? s : compareStrings(a.id, b.id);
    };

    this.headJobsByCreatedAt = new SortedSet<DbJob>((a, b) => {
      const d = a.createdAt.getTime() - b.createdAt.getTime();
      if (d !== 0) return d;
      const s = seq(a) - seq(b);
      return s !== 0 ? s : compareStrings(a.id, b.id);
    });
  }

  // ── Index maintenance ─────────────────────────────────────────────

  insertJob(job: DbJob): void {
    if (!this.seqByJobId.has(job.id)) this.seqByJobId.set(job.id, this.nextSeq++);

    if (isPending(job)) {
      let set = this.pendingByType.get(job.typeName);
      if (!set) {
        set = new SortedSet(this.cmpScheduledAt);
        this.pendingByType.set(job.typeName, set);
      }
      set.insert(job);
    } else if (isRunning(job)) {
      let set = this.runningByType.get(job.typeName);
      if (!set) {
        set = new SortedSet(this.cmpAttemptUntil);
        this.runningByType.set(job.typeName, set);
      }
      set.insert(job);
    }

    let chainMap = this.jobsByChain.get(job.chainId);
    if (!chainMap) {
      chainMap = new Map();
      this.jobsByChain.set(job.chainId, chainMap);
    }
    chainMap.set(job.chainIndex, job);

    const tail = this.tailByChain.get(job.chainId);
    if (!tail || job.chainIndex > tail.chainIndex) {
      this.tailByChain.set(job.chainId, job);
    }

    if (job.id === job.chainId) {
      this.headJobsByCreatedAt.insert(job);
      const indexKey = this.deduplicationIndexKey(job);
      if (indexKey) {
        let set = this.headJobsByDeduplicationKey.get(indexKey);
        if (!set) {
          set = new Set();
          this.headJobsByDeduplicationKey.set(indexKey, set);
        }
        set.add(job);
      }
    }
  }

  removeJob(job: DbJob): void {
    if (isPending(job)) {
      this.pendingByType.get(job.typeName)?.delete(job);
    } else if (isRunning(job)) {
      this.runningByType.get(job.typeName)?.delete(job);
    }

    const chainMap = this.jobsByChain.get(job.chainId);
    if (chainMap) {
      const stored = chainMap.get(job.chainIndex);
      if (stored && stored.id === job.id) {
        chainMap.delete(job.chainIndex);
        if (chainMap.size === 0) this.jobsByChain.delete(job.chainId);
      }
    }

    const tail = this.tailByChain.get(job.chainId);
    if (tail && tail.id === job.id) {
      let newTail: DbJob | undefined;
      const remaining = this.jobsByChain.get(job.chainId);
      if (remaining) {
        for (const candidate of remaining.values()) {
          if (!newTail || candidate.chainIndex > newTail.chainIndex) newTail = candidate;
        }
      }
      if (newTail) this.tailByChain.set(job.chainId, newTail);
      else this.tailByChain.delete(job.chainId);
    }

    if (job.id === job.chainId) {
      this.headJobsByCreatedAt.delete(job);
      const indexKey = this.deduplicationIndexKey(job);
      if (indexKey) {
        const set = this.headJobsByDeduplicationKey.get(indexKey);
        if (set) {
          set.delete(job);
          if (set.size === 0) this.headJobsByDeduplicationKey.delete(indexKey);
        }
      }
    }
  }

  // ── Journal writes ────────────────────────────────────────────────

  writeJob(
    journal: JournalEntry[] | undefined,
    prev: DbJob | undefined,
    next: DbJob | undefined,
  ): void {
    if (prev) this.removeJob(prev);
    if (next) {
      this.jobs.set(next.id, next);
      this.insertJob(next);
    } else if (prev) {
      this.jobs.delete(prev.id);
      this.seqByJobId.delete(prev.id);
    }
    if (journal) journal.push({ kind: "job", prev, next });
  }

  writeBlocker(
    journal: JournalEntry[] | undefined,
    jobId: string,
    key: string,
    prev: BlockerEntry | undefined,
    next: BlockerEntry | undefined,
  ): void {
    this.applyBlocker(jobId, key, prev, next);
    if (journal) journal.push({ kind: "blocker", jobId, key, prev, next });
  }

  rollbackTo(journal: JournalEntry[], target: number): void {
    while (journal.length > target) {
      const entry = journal.pop()!;
      if (entry.kind === "job") {
        if (entry.next) this.removeJob(entry.next);
        if (entry.prev) {
          this.jobs.set(entry.prev.id, entry.prev);
          this.insertJob(entry.prev);
        } else if (entry.next) {
          this.jobs.delete(entry.next.id);
          this.seqByJobId.delete(entry.next.id);
        }
      } else {
        this.applyBlocker(entry.jobId, entry.key, entry.next, entry.prev);
      }
    }
  }

  private applyBlocker(
    jobId: string,
    key: string,
    current: BlockerEntry | undefined,
    next: BlockerEntry | undefined,
  ): void {
    const map = this.jobBlockers.get(jobId);
    if (next) {
      if (map) {
        map.set(key, next);
      } else {
        this.jobBlockers.set(jobId, new Map([[key, next]]));
      }
      let referencingJobIds = this.blockedByChain.get(next.blockedByChainId);
      if (!referencingJobIds) {
        referencingJobIds = new Set();
        this.blockedByChain.set(next.blockedByChainId, referencingJobIds);
      }
      referencingJobIds.add(jobId);
      if (current && current.blockedByChainId !== next.blockedByChainId) {
        this.dropInverse(jobId, current.blockedByChainId);
      }
    } else if (map) {
      map.delete(key);
      if (map.size === 0) this.jobBlockers.delete(jobId);
      if (current) this.dropInverse(jobId, current.blockedByChainId);
    }
  }

  private dropInverse(jobId: string, blockedByChainId: string): void {
    const remaining = this.jobBlockers.get(jobId);
    if (remaining) {
      for (const entry of remaining.values()) {
        if (entry.blockedByChainId === blockedByChainId) return;
      }
    }
    const referencingJobIds = this.blockedByChain.get(blockedByChainId);
    if (referencingJobIds) {
      referencingJobIds.delete(jobId);
      if (referencingJobIds.size === 0) this.blockedByChain.delete(blockedByChainId);
    }
  }

  blockerRows(jobId: string, blockedByChainId: string): BlockerEntry[] {
    const map = this.jobBlockers.get(jobId);
    if (!map) return [];
    return Array.from(map.values())
      .filter((entry) => entry.blockedByChainId === blockedByChainId)
      .sort((a, b) => a.index - b.index);
  }

  // ── Queries ───────────────────────────────────────────────────────

  getTailJob(chainId: string): DbJob | undefined {
    return this.tailByChain.get(chainId);
  }

  findExistingContinuation(chainId: string, chainIndex: number): DbJob | undefined {
    const chainMap = this.jobsByChain.get(chainId);
    if (!chainMap) return undefined;
    const candidate = chainMap.get(chainIndex);
    if (!candidate || candidate.id === candidate.chainId) return undefined;
    return candidate;
  }

  findDeduplicatedJob(typeName: string, deduplication: DeduplicationOptions): DbJob | undefined {
    if (!deduplication.key) return undefined;

    const set = this.headJobsByDeduplicationKey.get(`${typeName}\u0000${deduplication.key}`);
    if (!set || set.size === 0) return undefined;

    const scope = deduplication.scope;

    let bestMatch: DbJob | undefined;
    for (const headJob of set) {
      if (scope === "running" && headJob.chainStatus !== "running") continue;
      if (!bestMatch || headJob.createdAt > bestMatch.createdAt) bestMatch = headJob;
    }
    return bestMatch;
  }

  findExternalBlockerRefs(chainIds: ReadonlySet<string>): Map<string, StateBlockedJob[]> {
    const result = new Map<string, StateBlockedJob[]>();
    for (const chainId of chainIds) {
      const referencingJobIds = this.blockedByChain.get(chainId);
      if (!referencingJobIds) continue;
      for (const referencingJobId of referencingJobIds) {
        const referencingJob = this.jobs.get(referencingJobId);
        if (!referencingJob) continue;
        if (chainIds.has(referencingJob.chainId)) continue;
        for (const entry of this.blockerRows(referencingJobId, chainId)) {
          let references = result.get(chainId);
          if (!references) {
            references = [];
            result.set(chainId, references);
          }
          references.push({
            jobId: referencingJobId,
            blockedByChainId: chainId,
            index: entry.index,
            traceContext: entry.traceContext,
            job: referencingJob,
          });
        }
      }
    }
    return result;
  }

  clear(): void {
    this.jobs.clear();
    this.pendingByType.clear();
    this.runningByType.clear();
    this.jobsByChain.clear();
    this.tailByChain.clear();
    this.headJobsByDeduplicationKey.clear();
    this.jobBlockers.clear();
    this.blockedByChain.clear();
    this.headJobsByCreatedAt.clear();
    this.seqByJobId.clear();
  }

  private deduplicationIndexKey(job: DbJob): string | undefined {
    return job.deduplicationKey != null
      ? `${job.typeName}\u0000${job.deduplicationKey}`
      : undefined;
  }
}

// ── Adapter ─────────────────────────────────────────────────────────

/** Transaction context for the in-process state adapter. */
export type InProcessContext = { inTransaction: true; journal: JournalEntry[] };

/** State adapter backed by in-memory data structures. Suitable for testing and single-process deployments without persistence. */
export type InProcessStateAdapter = StateAdapter<InProcessContext, string>;

/**
 * @param options - Optional ID generation and validation overrides.
 */
export const createInProcessStateAdapter = async ({
  generateId: generateIdOption = () => crypto.randomUUID(),
  validateId: validateIdOption,
}: {
  generateId?: () => string;
  validateId?: (id: string) => boolean;
} = {}): Promise<InProcessStateAdapter> => {
  const { validateId, generateId } = createIdValidator({ generateIdOption, validateIdOption });
  const idx = new JobIndex();
  const lock = createAsyncRwLock();
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Error("StateAdapter is closed");
  };

  const withWriteLock = async <T>(txCtx: InProcessContext | undefined, fn: () => T): Promise<T> => {
    if (txCtx?.inTransaction) return fn();
    using _h = await lock.acquireWrite();
    assertOpen();
    return fn();
  };

  const withReadLock = async <T>(txCtx: InProcessContext | undefined, fn: () => T): Promise<T> => {
    if (txCtx?.inTransaction) return fn();
    using _h = await lock.acquireRead();
    assertOpen();
    return fn();
  };

  // A batch that throws midway leaves none of its writes behind, matching the SQL adapters,
  // whose batch is a single statement — even if the caller catches the error and commits.
  const withAtomicBatch = <T>(
    txCtx: InProcessContext | undefined,
    fn: (journal: JournalEntry[]) => T,
  ): T => {
    const batchJournal: JournalEntry[] = [];
    let result: T;
    try {
      result = fn(batchJournal);
    } catch (error) {
      idx.rollbackTo(batchJournal, 0);
      throw error;
    }
    const journal = txCtx?.journal;
    if (journal) {
      for (const entry of batchJournal) journal.push(entry);
    }
    return result;
  };

  const chainPair = (headJob: DbJob): [DbJob, DbJob | undefined] => {
    const tailJob = idx.getTailJob(headJob.id);
    return [headJob, tailJob && tailJob.id !== headJob.id ? tailJob : undefined];
  };

  const chainOf = (headJob: DbJob): StateChainInfo => ({
    id: headJob.id,
    typeName: headJob.typeName,
    status: headJob.chainStatus!,
    deduplicationKey: headJob.deduplicationKey,
    createdAt: headJob.createdAt,
    completedAt: headJob.chainCompletedAt,
    traceContext: headJob.chainTraceContext,
  });

  const chainView = (headJob: DbJob): StateChain => {
    const [head, tail] = chainPair(headJob);
    return { ...chainOf(head), head, tail };
  };

  const jobView = (job: DbJob): StateJob => ({
    ...job,
    chain: chainOf(idx.jobs.get(job.chainId) ?? job),
  });

  const chainJobViews = (headJob: DbJob | undefined, jobs: DbJob[]): StateJob[] => {
    if (!headJob) return [];
    const chain = chainOf(headJob);
    return jobs.map((job) => ({ ...job, chain }));
  };

  const adapter: InProcessStateAdapter = {
    transactionConcurrency: "serialized",

    withTransaction: async (fn) => {
      using _h = await lock.acquireWrite();
      assertOpen();
      const journal: JournalEntry[] = [];
      const txCtx: InProcessContext = { inTransaction: true, journal };
      try {
        return await fn(txCtx);
      } catch (error) {
        idx.rollbackTo(journal, 0);
        throw error;
      }
    },

    getChains: async ({ txCtx, chainIds }) =>
      withReadLock(txCtx, () =>
        chainIds.map((chainId) => {
          const headJob = idx.jobs.get(chainId);
          return headJob && headJob.id === headJob.chainId ? chainView(headJob) : undefined;
        }),
      ),

    getJobs: async ({ txCtx, jobIds }) =>
      withReadLock(txCtx, () =>
        jobIds.map((jobId): StateJob | undefined => {
          const job = idx.jobs.get(jobId);
          return job ? jobView(job) : undefined;
        }),
      ),

    createJobs: async ({ txCtx, jobs: jobInputs }) =>
      withWriteLock(txCtx, () => {
        for (const jobInput of jobInputs) {
          if (jobInput.id !== undefined) validateId(jobInput.id, "caller");
        }
        return withAtomicBatch(txCtx, (journal) => {
          const results: (StateChain & { deduplicated: boolean })[] = [];
          for (const jobInput of jobInputs) {
            const {
              typeName,
              id: providedId,
              input,
              schedule,
              chainTraceContext,
              traceContext,
              deduplication,
            } = jobInput;

            if (deduplication) {
              const existing = idx.findDeduplicatedJob(typeName, deduplication);
              if (existing) {
                results.push({ ...chainView(existing), deduplicated: true });
                continue;
              }
            }

            const id = providedId ?? generateId();

            if (idx.jobs.has(id)) {
              throw new Error(`Job id "${id}" already exists`);
            }

            const job = buildDbJob({
              id,
              typeName,
              chainId: id,
              chainIndex: 0,
              deduplicationKey: deduplication?.key ?? null,
              input,
              schedule,
              chainTraceContext,
              traceContext,
            });

            idx.writeJob(journal, undefined, job);
            results.push({ ...chainView(job), deduplicated: false });
          }
          return results;
        });
      }),

    continueJobs: async ({ txCtx, completedBy, jobs: jobInputs }) =>
      withWriteLock(txCtx, () => {
        for (const jobInput of jobInputs) {
          if (jobInput.id !== undefined) validateId(jobInput.id, "caller");
        }
        return withAtomicBatch(txCtx, (journal) => {
          const now = new Date();
          const results: ((StateJob & { continuation: StateJobInfo }) | undefined)[] = [];

          const parents = jobInputs.map((jobInput) => {
            const parent = idx.jobs.get(jobInput.continueFromId);
            return !parent || isCompleted(parent) || !matchesFence(parent, jobInput.fence)
              ? undefined
              : parent;
          });

          for (const [index, jobInput] of jobInputs.entries()) {
            const { typeName, id: providedId, input, schedule, traceContext } = jobInput;

            const parent = parents[index];
            if (!parent) {
              results.push(undefined);
              continue;
            }
            const chainIndex = parent.chainIndex + 1;

            if (idx.findExistingContinuation(parent.chainId, chainIndex)) {
              throw new Error(`Chain "${parent.chainId}" already has a job at index ${chainIndex}`);
            }

            const id = providedId ?? generateId();

            if (idx.jobs.has(id)) {
              throw new Error(`Job id "${id}" already exists`);
            }

            const continuation = buildDbJob({
              id,
              typeName,
              chainId: parent.chainId,
              chainIndex,
              deduplicationKey: null,
              input,
              schedule,
              chainTraceContext: null,
              traceContext,
            });
            idx.writeJob(journal, undefined, continuation);

            const completedJob: DbJob = {
              ...parent,
              attemptAt: null,
              attemptBy: null,
              attemptUntil: null,
              continuedToId: id,
              status: "completed",
              completedAt: now,
              completedBy: completedBy ?? null,
              output: null,
              lastAttemptError: null,
            };
            idx.writeJob(journal, parent, completedJob);

            results.push({ ...jobView(completedJob), continuation });
          }

          return results;
        });
      }),

    completeJobs: async ({ txCtx, completedBy, jobs: jobInputs }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const now = new Date();
        return jobInputs.map(({ jobId, output, fence }) => {
          const job = idx.jobs.get(jobId);
          if (!job || isCompleted(job) || !matchesFence(job, fence)) return undefined;

          const updatedJob: DbJob = {
            ...job,
            attemptAt: null,
            attemptBy: null,
            attemptUntil: null,
            output: output ?? null,
            status: "completed",
            completedAt: now,
            completedBy: completedBy ?? null,
            lastAttemptError: null,
            ...(job.id === job.chainId
              ? { chainStatus: "completed" as const, chainCompletedAt: now }
              : {}),
          };
          idx.writeJob(journal, job, updatedJob);

          let head = updatedJob;
          if (job.id !== job.chainId) {
            const headJob = idx.jobs.get(job.chainId);
            if (!headJob) throw new Error(`Chain ${job.chainId} not found`);
            head = {
              ...headJob,
              chainStatus: "completed",
              chainCompletedAt: headJob.chainCompletedAt ?? now,
            };
            idx.writeJob(journal, headJob, head);
          }

          return jobView(updatedJob);
        });
      }),

    rescheduleJobs: async ({ txCtx, jobs }) =>
      withWriteLock(txCtx, () => {
        if (jobs.length === 0) return [];
        const journal = txCtx?.journal;
        const now = new Date();
        const results: (StateJob | undefined)[] = [];
        const resultById = new Map<string, StateJob | undefined>();
        for (const { jobId, schedule, error, fence } of jobs) {
          if (resultById.has(jobId)) {
            results.push(resultById.get(jobId));
            continue;
          }
          const job = idx.jobs.get(jobId);
          if (!job || isCompleted(job) || !matchesFence(job, fence)) {
            resultById.set(jobId, undefined);
            results.push(undefined);
            continue;
          }
          const requestedScheduledAt =
            schedule?.at ?? (schedule?.afterMs ? new Date(now.getTime() + schedule.afterMs) : now);
          const resolvedScheduledAt = clampToFloor(requestedScheduledAt, now);
          const updatedJob: DbJob = {
            ...job,
            scheduledAt: resolvedScheduledAt,
            attemptAt: null,
            attemptBy: null,
            attemptUntil: null,
            ...(isRunning(job)
              ? { status: "pending" as const, lastAttemptAt: now, lastAttemptError: error ?? null }
              : {}),
          };
          idx.writeJob(journal, job, updatedJob);
          const view = jobView(updatedJob);
          resultById.set(jobId, view);
          results.push(view);
        }
        return results;
      }),

    deleteChains: async ({ txCtx, chainIds }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const uniqueChainIds = new Set<string>(chainIds);

        const externalBlockers = idx.findExternalBlockerRefs(uniqueChainIds);
        if (externalBlockers.size > 0) {
          return chainIds.map((chainId) => externalBlockers.get(chainId) ?? undefined);
        }

        const result: (StateChain | undefined)[] = chainIds.map((chainId) => {
          const headJob = idx.jobs.get(chainId);
          return headJob && headJob.id === headJob.chainId ? chainView(headJob) : undefined;
        });

        const jobsToRemove: DbJob[] = [];
        for (const chainId of uniqueChainIds) {
          const chainMap = idx.jobsByChain.get(chainId);
          if (!chainMap) continue;
          for (const job of chainMap.values()) jobsToRemove.push(job);
        }

        for (const job of jobsToRemove) {
          const map = idx.jobBlockers.get(job.id);
          if (map) {
            for (const [key, entry] of Array.from(map.entries())) {
              idx.writeBlocker(journal, job.id, key, entry, undefined);
            }
          }
          idx.writeJob(journal, job, undefined);
        }

        return result;
      }),

    startJobAttempt: async ({ txCtx, timeoutMsByTypeName, workerId }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const now = new Date();
        const nowMs = now.getTime();

        let bestJob: DbJob | undefined;
        for (const typeName of Object.keys(timeoutMsByTypeName)) {
          const candidate = idx.pendingByType.get(typeName)?.first();
          if (!candidate) continue;
          if (candidate.scheduledAt.getTime() > nowMs) continue;
          if (!bestJob || idx.cmpScheduledAt(candidate, bestJob) < 0) bestJob = candidate;
        }

        if (!bestJob) return undefined;

        const updatedJob: DbJob = {
          ...bestJob,
          status: "running",
          attempt: bestJob.attempt + 1,
          attemptAt: now,
          attemptBy: workerId,
          attemptUntil: new Date(nowMs + timeoutMsByTypeName[bestJob.typeName]),
        };
        idx.writeJob(journal, bestJob, updatedJob);
        return jobView(updatedJob);
      }),

    getStartAttemptDelayMs: async ({ txCtx, typeNames }) =>
      withReadLock(txCtx, () => {
        const now = Date.now();
        let nextScheduledAt: number | null = null;

        for (const typeName of typeNames) {
          const set = idx.pendingByType.get(typeName);
          if (!set) continue;
          for (let i = 0; i < set.size; i++) {
            const t = set.at(i)!.scheduledAt.getTime();
            if (nextScheduledAt === null || t < nextScheduledAt) nextScheduledAt = t;
            break;
          }
        }

        if (nextScheduledAt === null) return null;
        return Math.max(0, nextScheduledAt - now);
      }),

    extendJobAttempt: async ({ txCtx, jobId, fence, timeoutMs }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const job = idx.jobs.get(jobId);
        if (!job || !matchesFence(job, fence)) return undefined;

        const updatedJob: DbJob = { ...job, attemptUntil: new Date(Date.now() + timeoutMs) };
        idx.writeJob(journal, job, updatedJob);
        return jobView(updatedJob);
      }),

    reclaimExpiredJobAttempt: async ({ txCtx, typeNames, ignoredJobIds, lastAttemptError }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const now = Date.now();
        const ignoredSet = ignoredJobIds ? new Set(ignoredJobIds) : undefined;

        let candidateJob: DbJob | undefined;
        for (const typeName of typeNames) {
          const set = idx.runningByType.get(typeName);
          if (!set) continue;
          for (let i = 0; i < set.size; i++) {
            const job = set.at(i)!;
            if (!job.attemptUntil) break;
            const attemptUntil = job.attemptUntil.getTime();
            if (attemptUntil > now) break;
            if (ignoredSet?.has(job.id)) continue;
            if (!candidateJob || attemptUntil < candidateJob.attemptUntil!.getTime()) {
              candidateJob = job;
            }
            break;
          }
        }

        if (!candidateJob) return undefined;

        const updatedJob: DbJob = {
          ...candidateJob,
          status: "pending",
          attemptBy: null,
          attemptUntil: null,
          attemptAt: null,
          lastAttemptAt: new Date(now),
          lastAttemptError,
        };
        idx.writeJob(journal, candidateJob, updatedJob);
        return jobView(updatedJob);
      }),

    addJobsBlockers: async ({ txCtx, jobBlockers: jobBlockerInputs }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const results: (StateJob & { blockers: (StateChainInfo | undefined)[] })[] = [];

        const missingJobIds = jobBlockerInputs
          .map(({ jobId }) => jobId)
          .filter((jobId) => !idx.jobs.has(jobId));
        if (missingJobIds.length > 0) {
          throw new Error(
            `addJobsBlockers requires existing jobs; not found: ${missingJobIds.join(", ")}`,
          );
        }

        for (const { jobId, blockedByChainIds, blockerTraceContexts } of jobBlockerInputs) {
          const job = idx.jobs.get(jobId)!;

          const blockers: (StateChainInfo | undefined)[] = blockedByChainIds.map(
            (blockerChainId, index) => {
              const headJob = idx.jobs.get(blockerChainId);
              if (!headJob || headJob.id !== headJob.chainId) return undefined;
              const key = blockerKey(blockerChainId, index);
              const prev = idx.jobBlockers.get(jobId)?.get(key);
              const traceContext = blockerTraceContexts?.[index] ?? null;
              idx.writeBlocker(journal, jobId, key, prev, {
                blockedByChainId: blockerChainId,
                index,
                traceContext,
              });
              return chainOf(headJob);
            },
          );

          const hasIncomplete = blockers.some((chain) => chain?.status === "running");
          if (hasIncomplete && isPending(job)) {
            const updatedJob: DbJob = { ...job, status: "blocked" };
            idx.writeJob(journal, job, updatedJob);
            results.push({ ...jobView(updatedJob), blockers });
          } else {
            results.push({ ...jobView(job), blockers });
          }
        }

        return results;
      }),

    getJobBlockers: async ({ txCtx, jobId }) =>
      withReadLock(txCtx, () => {
        const blockerMap = idx.jobBlockers.get(jobId);
        if (!blockerMap) return [];

        return Array.from(blockerMap.values())
          .sort((a, b) => a.index - b.index)
          .flatMap(({ blockedByChainId }) => {
            const headJob = idx.jobs.get(blockedByChainId);
            if (!headJob) return [];
            return [chainView(headJob)];
          });
      }),

    unblockJobs: async ({ txCtx, blockedByChainId }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const result: StateDependentJob[] = [];
        const now = new Date();

        const blockedJobIds = idx.blockedByChain.get(blockedByChainId);
        if (!blockedJobIds || blockedJobIds.size === 0) return result;

        for (const jobId of Array.from(blockedJobIds)) {
          const blockerMap = idx.jobBlockers.get(jobId);
          if (!blockerMap) continue;
          const entries = idx.blockerRows(jobId, blockedByChainId);
          if (entries.length === 0) continue;

          let job = idx.jobs.get(jobId);
          if (!job) continue;

          if (job.status === "blocked") {
            let allComplete = true;
            for (const { blockedByChainId: otherBlockerChainId } of blockerMap.values()) {
              const blockerHead = idx.jobs.get(otherBlockerChainId);
              if (!blockerHead || blockerHead.chainStatus !== "completed") {
                allComplete = false;
                break;
              }
            }

            if (allComplete) {
              const updatedJob: DbJob = {
                ...job,
                status: "pending",
                scheduledAt: clampToFloor(job.scheduledAt, now),
              };
              idx.writeJob(journal, job, updatedJob);
              job = updatedJob;
            }
          }

          for (const entry of entries) {
            result.push({
              jobId,
              blockedByChainId,
              index: entry.index,
              traceContext: entry.traceContext,
              job: jobView(job),
            });
          }
        }

        result.sort((a, b) => {
          const cmp = compareStrings(a.jobId, b.jobId);
          return cmp !== 0 ? cmp : a.index - b.index;
        });

        return result;
      }),

    listChainTypeNames: async ({ txCtx }) =>
      withReadLock(txCtx, () => {
        const names = new Set<string>();
        for (const headJob of idx.headJobsByCreatedAt.iterate("asc")) {
          names.add(headJob.typeName);
        }
        return Array.from(names);
      }),

    listJobTypeNames: async ({ txCtx }) =>
      withReadLock(txCtx, () => {
        const names = new Set<string>();
        for (const job of idx.jobs.values()) {
          names.add(job.typeName);
        }
        return Array.from(names);
      }),

    countByChainTypeNames: async ({ txCtx, typeNames }) =>
      withReadLock(txCtx, () => {
        const counts = new Map<string, { running: number; completed: number }>();
        for (const name of typeNames) {
          counts.set(name, { running: 0, completed: 0 });
        }

        for (const headJob of idx.headJobsByCreatedAt.iterate("asc")) {
          const typeCounts = counts.get(headJob.typeName);
          if (!typeCounts) continue;
          if (headJob.chainStatus === "completed") {
            if (typeCounts.completed <= COUNT_CAP) typeCounts.completed++;
          } else {
            if (typeCounts.running <= COUNT_CAP) typeCounts.running++;
          }
        }

        return typeNames.map((name) => {
          const typeCounts = counts.get(name)!;
          return {
            running: cappedCount(typeCounts.running),
            completed: cappedCount(typeCounts.completed),
          };
        });
      }),

    countByJobTypeNames: async ({ txCtx, typeNames }) =>
      withReadLock(txCtx, () => {
        const counts = new Map<
          string,
          { blocked: number; pending: number; running: number; completed: number }
        >();
        for (const name of typeNames) {
          counts.set(name, { blocked: 0, pending: 0, running: 0, completed: 0 });
        }

        for (const job of idx.jobs.values()) {
          const typeCounts = counts.get(job.typeName);
          if (!typeCounts) continue;
          if (typeCounts[job.status] <= COUNT_CAP) typeCounts[job.status]++;
        }

        return typeNames.map((name) => {
          const typeCounts = counts.get(name)!;
          return {
            blocked: cappedCount(typeCounts.blocked),
            pending: cappedCount(typeCounts.pending),
            running: cappedCount(typeCounts.running),
            completed: cappedCount(typeCounts.completed),
          };
        });
      }),

    listChains: async ({
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
      withReadLock(txCtx, () => {
        const blockerChainIds =
          independent !== undefined ? new Set<string>(idx.blockedByChain.keys()) : undefined;

        const chains: [DbJob, DbJob | undefined][] = [];
        for (const headJob of idx.headJobsByCreatedAt.iterate("asc")) {
          if (blockerChainIds) {
            const isBlocker = blockerChainIds.has(headJob.id);
            if (independent === true && isBlocker) continue;
            if (independent === false && !isBlocker) continue;
          }
          if (!matchesTypeNameFilter(headJob, typeName)) continue;
          if (!matchesChainStatus(headJob, status)) continue;
          const pair = chainPair(headJob);
          if (!matchesDateRange(chainTimestampGetters[orderBy](pair), from, to)) continue;
          chains.push(pair);
        }

        const chainPage = paginateByTimestamp(
          chains,
          page,
          orderDirection,
          orderBy,
          chainTimestampGetters[orderBy],
        );
        return {
          items: chainPage.items.map(([head, tail]) => ({ ...chainOf(head), head, tail })),
          nextCursor: chainPage.nextCursor,
        };
      }),

    listJobs: async (params) =>
      withReadLock(params.txCtx, () => {
        const { typeName, from, to, status, orderBy, orderDirection, page } = params;

        const matched: DbJob[] = [];
        for (const job of idx.jobs.values()) {
          if (!matchesJobStatus(job, status)) continue;
          if (!matchesTypeNameFilter(job, typeName)) continue;
          if (!matchesDateRange(jobTimestampGetters[orderBy](job), from, to)) continue;
          matched.push(job);
        }

        const jobPage = paginateByTimestamp(
          matched,
          page,
          orderDirection,
          orderBy,
          jobTimestampGetters[orderBy],
        );
        return { items: jobPage.items.map(jobView), nextCursor: jobPage.nextCursor };
      }),

    listChainJobs: async ({ txCtx, chainId, orderDirection, page }) =>
      withReadLock(txCtx, () => {
        const chainMap = idx.jobsByChain.get(chainId);
        const matched: DbJob[] = chainMap ? Array.from(chainMap.values()) : [];
        const jobPage = paginateByChainIndex(matched, idx.jobs, page, orderDirection);
        return {
          items: chainJobViews(idx.jobs.get(chainId), jobPage.items),
          nextCursor: jobPage.nextCursor,
        };
      }),

    listBlockedJobs: async ({ txCtx, chainId, orderDirection, page }) =>
      withReadLock(txCtx, () => {
        const blockedJobIds = idx.blockedByChain.get(chainId);
        const matched: DbJob[] = [];
        if (blockedJobIds) {
          for (const jobId of blockedJobIds) {
            const job = idx.jobs.get(jobId);
            if (job) matched.push(job);
          }
        }
        const jobPage = paginateByTimestamp(
          matched,
          page,
          orderDirection,
          "createdAt",
          jobTimestampGetters.createdAt,
        );
        return { items: jobPage.items.map(jobView), nextCursor: jobPage.nextCursor };
      }),

    close: async () => {
      using _h = await lock.acquireWrite();
      if (closed) return;
      closed = true;
      idx.clear();
    },
  };

  return adapter;
};
