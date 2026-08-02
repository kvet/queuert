import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type BlockerReference } from "../errors.js";
import { createAsyncRwLock } from "../helpers/async-rw-lock.js";
import { type OrderDirection, type Page, type PageParams } from "../pagination.js";
import { decodeIdCursor, decodeTimestampWithIdCursor, encodeCursor } from "./cursor.js";
import { createIdValidator } from "./id-validator.js";
import { type StateAdapter, type StateJob } from "./state-adapter.js";

type DbJob = StateJob & { chainIndex: number };
type Comparator<T> = (a: T, b: T) => number;
type BlockerEntry = { index: number; traceContext: string | null };
type JournalEntry =
  | { kind: "job"; prev: DbJob | undefined; next: DbJob | undefined }
  | {
      kind: "blocker";
      jobId: string;
      blockerChainId: string;
      prev: BlockerEntry | undefined;
      next: BlockerEntry | undefined;
    };

// ── Status helpers ──────────────────────────────────────────────────

const isCompleted = (job: DbJob): boolean => job.completedAt !== null;
const isRunning = (job: DbJob): boolean => job.attemptAt !== null && !isCompleted(job);
const isPending = (job: DbJob): boolean => !isCompleted(job) && job.attemptAt === null;
const isRunnablePending = (job: DbJob): boolean => !job.blocked && isPending(job);
const isChainCompleted = (tail: DbJob): boolean => isCompleted(tail) && tail.continuedToId === null;

const matchesChainStatus = (
  headJob: DbJob,
  tailJob: DbJob | undefined,
  status?: string,
): boolean => {
  if (status === "completed") return isChainCompleted(tailJob ?? headJob);
  if (status === "running") return !isChainCompleted(tailJob ?? headJob);
  return true;
};

const matchesJobStatus = (
  job: DbJob,
  status?: string,
  blocked?: boolean,
  continued?: boolean,
): boolean => {
  if (status === "completed") {
    if (!isCompleted(job)) return false;
    if (continued !== undefined && continued !== (job.continuedToId !== null)) return false;
    return true;
  }
  if (status === "running") return isRunning(job);
  if (status === "pending") {
    if (!isPending(job)) return false;
    if (blocked !== undefined && job.blocked !== blocked) return false;
    return true;
  }
  return true;
};

const matchesDateRange = (createdAt: Date, from?: Date, to?: Date): boolean => {
  if (from && createdAt < from) return false;
  if (to && createdAt > to) return false;
  return true;
};

const matchesTypeNameFilter = (job: DbJob, typeNames?: string[]): boolean =>
  !typeNames || typeNames.length === 0 || typeNames.includes(job.typeName);

const matchesChainTypeNameFilter = (job: DbJob, chainTypeNames?: string[]): boolean =>
  !chainTypeNames || chainTypeNames.length === 0 || chainTypeNames.includes(job.chainTypeName);

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
  const dir = orderDirection === "desc" ? -1 : 1;
  const sorted = items.toSorted((a, b) => {
    const d = getTimestamp(a).getTime() - getTimestamp(b).getTime();
    if (d !== 0) return d * dir;
    const idA = paginateItemId(a);
    const idB = paginateItemId(b);
    return idA < idB ? -dir : idA > idB ? dir : 0;
  });

  let startIndex = 0;
  if (page.cursor) {
    const cursor = decodeTimestampWithIdCursor(page.cursor, sortKey);
    startIndex = sorted.findIndex((item) => {
      const sv = getTimestamp(item).toISOString();
      const id = paginateItemId(item);
      if (orderDirection === "desc") {
        return sv < cursor.value || (sv === cursor.value && id < cursor.id);
      }
      return sv > cursor.value || (sv === cursor.value && id > cursor.id);
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
  createdAt: ([root]) => root.createdAt,
  completedAt: ([root, last]) => (last ?? root).completedAt!,
};

const paginateByChainIndex = (
  items: DbJob[],
  jobsById: Map<string, DbJob>,
  page: PageParams,
  orderDirection: OrderDirection,
): Page<DbJob> => {
  const dir = orderDirection === "asc" ? 1 : -1;
  const sorted = items.toSorted((a, b) => {
    const d = a.chainIndex - b.chainIndex;
    if (d !== 0) return d * dir;
    return a.id < b.id ? -dir : a.id > b.id ? dir : 0;
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
  chainTypeName: string;
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
    chainTypeName: params.chainTypeName,
    chainIndex: params.chainIndex,
    continuedToId: null,
    input: params.input,
    output: null,
    chainId: params.chainId,
    blocked: false,
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
  readonly lastByChain = new Map<string, DbJob>();
  readonly dedupByKey = new Map<string, Set<DbJob>>();
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

    if (isRunnablePending(job)) {
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

    const last = this.lastByChain.get(job.chainId);
    if (!last || job.chainIndex > last.chainIndex) {
      this.lastByChain.set(job.chainId, job);
    }

    if (job.id === job.chainId) {
      this.headJobsByCreatedAt.insert(job);
      const k = this.dedupKeyFor(job);
      if (k) {
        let set = this.dedupByKey.get(k);
        if (!set) {
          set = new Set();
          this.dedupByKey.set(k, set);
        }
        set.add(job);
      }
    }
  }

  removeJob(job: DbJob): void {
    if (isRunnablePending(job)) {
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

    const last = this.lastByChain.get(job.chainId);
    if (last && last.id === job.id) {
      let newLast: DbJob | undefined;
      const remaining = this.jobsByChain.get(job.chainId);
      if (remaining) {
        for (const j of remaining.values()) {
          if (!newLast || j.chainIndex > newLast.chainIndex) newLast = j;
        }
      }
      if (newLast) this.lastByChain.set(job.chainId, newLast);
      else this.lastByChain.delete(job.chainId);
    }

    if (job.id === job.chainId) {
      this.headJobsByCreatedAt.delete(job);
      const k = this.dedupKeyFor(job);
      if (k) {
        const set = this.dedupByKey.get(k);
        if (set) {
          set.delete(job);
          if (set.size === 0) this.dedupByKey.delete(k);
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
    blockerChainId: string,
    prev: BlockerEntry | undefined,
    next: BlockerEntry | undefined,
  ): void {
    const map = this.jobBlockers.get(jobId);
    if (next) {
      if (map) {
        map.set(blockerChainId, next);
      } else {
        this.jobBlockers.set(jobId, new Map([[blockerChainId, next]]));
      }
      let inv = this.blockedByChain.get(blockerChainId);
      if (!inv) {
        inv = new Set();
        this.blockedByChain.set(blockerChainId, inv);
      }
      inv.add(jobId);
    } else if (map) {
      map.delete(blockerChainId);
      if (map.size === 0) this.jobBlockers.delete(jobId);
      const inv = this.blockedByChain.get(blockerChainId);
      if (inv) {
        inv.delete(jobId);
        if (inv.size === 0) this.blockedByChain.delete(blockerChainId);
      }
    }
    if (journal) journal.push({ kind: "blocker", jobId, blockerChainId, prev, next });
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
        const map = this.jobBlockers.get(entry.jobId);
        if (entry.prev) {
          if (map) {
            map.set(entry.blockerChainId, entry.prev);
          } else {
            this.jobBlockers.set(entry.jobId, new Map([[entry.blockerChainId, entry.prev]]));
          }
          let inv = this.blockedByChain.get(entry.blockerChainId);
          if (!inv) {
            inv = new Set();
            this.blockedByChain.set(entry.blockerChainId, inv);
          }
          inv.add(entry.jobId);
        } else if (map) {
          map.delete(entry.blockerChainId);
          if (map.size === 0) this.jobBlockers.delete(entry.jobId);
          const inv = this.blockedByChain.get(entry.blockerChainId);
          if (inv) {
            inv.delete(entry.jobId);
            if (inv.size === 0) this.blockedByChain.delete(entry.blockerChainId);
          }
        }
      }
    }
  }

  // ── Queries ───────────────────────────────────────────────────────

  getLastJob(chainId: string): DbJob | undefined {
    return this.lastByChain.get(chainId);
  }

  findExistingContinuation(chainId: string, chainIndex: number): DbJob | undefined {
    const chainMap = this.jobsByChain.get(chainId);
    if (!chainMap) return undefined;
    const candidate = chainMap.get(chainIndex);
    if (!candidate || candidate.id === candidate.chainId) return undefined;
    return candidate;
  }

  findDeduplicatedJob(
    chainTypeName: string,
    deduplication: DeduplicationOptions<string>,
  ): DbJob | undefined {
    if (!deduplication.key) return undefined;

    const set = this.dedupByKey.get(`${chainTypeName}\u0000${deduplication.key}`);
    if (!set || set.size === 0) return undefined;

    const now = Date.now();
    const scope = deduplication.scope;
    const exclude = deduplication.excludeChainIds
      ? new Set(deduplication.excludeChainIds)
      : undefined;
    const windowStart =
      deduplication.windowMs !== undefined ? now - deduplication.windowMs : undefined;

    let bestMatch: DbJob | undefined;
    for (const job of set) {
      if (exclude?.has(job.chainId)) continue;
      if (scope === "running") {
        const tail = this.lastByChain.get(job.chainId);
        if (tail && isChainCompleted(tail)) continue;
      }
      if (windowStart !== undefined && job.createdAt.getTime() < windowStart) continue;
      if (!bestMatch || job.createdAt > bestMatch.createdAt) bestMatch = job;
    }
    return bestMatch;
  }

  expandChainIds(chainIds: readonly string[]): string[] {
    const visited = new Set(chainIds);
    const queue = [...chainIds];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const blockerMap = this.jobBlockers.get(current);
      if (!blockerMap) continue;
      for (const blockerChainId of blockerMap.keys()) {
        if (!visited.has(blockerChainId)) {
          visited.add(blockerChainId);
          queue.push(blockerChainId);
        }
      }
    }
    return [...visited];
  }

  findExternalBlockerRefs(effectiveChainIds: readonly string[]): BlockerReference[] {
    const chainIdSet = new Set(effectiveChainIds);
    const refs: BlockerReference[] = [];
    for (const chainId of effectiveChainIds) {
      const referencingJobIds = this.blockedByChain.get(chainId);
      if (!referencingJobIds) continue;
      for (const refJobId of referencingJobIds) {
        const refJob = this.jobs.get(refJobId);
        if (!refJob) continue;
        if (chainIdSet.has(refJob.chainId)) continue;
        refs.push({ chainId, referencedByJobId: refJobId });
      }
    }
    return refs;
  }

  clear(): void {
    this.jobs.clear();
    this.pendingByType.clear();
    this.runningByType.clear();
    this.jobsByChain.clear();
    this.lastByChain.clear();
    this.dedupByKey.clear();
    this.jobBlockers.clear();
    this.blockedByChain.clear();
    this.headJobsByCreatedAt.clear();
    this.seqByJobId.clear();
  }

  private dedupKeyFor(job: DbJob): string | undefined {
    return job.deduplicationKey != null
      ? `${job.chainTypeName}\u0000${job.deduplicationKey}`
      : undefined;
  }
}

// ── Adapter ─────────────────────────────────────────────────────────

/** Transaction context for the in-process state adapter. */
export type InProcessContext = { inTransaction?: boolean; journal?: JournalEntry[] };

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

  const chainPair = (headJob: DbJob): [DbJob, DbJob | undefined] => {
    const tailJob = idx.getLastJob(headJob.id);
    return [headJob, tailJob && tailJob.id !== headJob.id ? tailJob : undefined];
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

    withSavepoint: async (txCtx, fn) => {
      if (!txCtx.journal) throw new Error("withSavepoint called outside a transaction");
      const journal = txCtx.journal;
      const start = journal.length;
      try {
        return await fn(txCtx);
      } catch (error) {
        idx.rollbackTo(journal, start);
        throw error;
      }
    },

    getChains: async ({ txCtx, chainIds }) =>
      withReadLock(txCtx, () =>
        chainIds.map((chainId) => {
          const headJob = idx.jobs.get(chainId);
          return headJob ? chainPair(headJob) : undefined;
        }),
      ),

    getChainsByDeduplication: async ({ txCtx, chainTypeName, deduplications }) =>
      withReadLock(txCtx, () =>
        deduplications.map((deduplication) => {
          const headJob = idx.findDeduplicatedJob(chainTypeName, deduplication);
          return headJob ? chainPair(headJob) : undefined;
        }),
      ),

    getJobs: async ({ txCtx, jobIds }) =>
      withReadLock(txCtx, () => jobIds.map((jobId): StateJob | undefined => idx.jobs.get(jobId))),

    createChains: async ({ txCtx, jobs: jobInputs }) =>
      withWriteLock(txCtx, () => {
        for (const jobInput of jobInputs) {
          if (jobInput.id !== undefined) validateId(jobInput.id, "caller");
        }
        const journal = txCtx?.journal;
        const results: { job: DbJob; deduplicated: boolean }[] = [];
        for (const jobInput of jobInputs) {
          const {
            typeName,
            id: providedId,
            input,
            schedule,
            chainTraceContext,
            traceContext,
            chainTypeName,
            deduplication,
          } = jobInput;

          if (deduplication) {
            const existing = idx.findDeduplicatedJob(chainTypeName, deduplication);
            if (existing) {
              results.push({ job: existing, deduplicated: true });
              continue;
            }
          }

          const id = providedId ?? generateId();
          const job = buildDbJob({
            id,
            typeName,
            chainId: id,
            chainTypeName,
            chainIndex: 0,
            deduplicationKey: deduplication?.key ?? null,
            input,
            schedule,
            chainTraceContext,
            traceContext,
          });

          idx.writeJob(journal, undefined, job);
          results.push({ job, deduplicated: false });
        }
        return results;
      }),

    createContinuationJob: async ({ txCtx, job: jobInput }) =>
      withWriteLock(txCtx, () => {
        if (jobInput.id !== undefined) validateId(jobInput.id, "caller");
        const journal = txCtx?.journal;
        const {
          typeName,
          id: providedId,
          input,
          schedule,
          chainTraceContext,
          traceContext,
          continueFromId,
        } = jobInput;

        const parent = idx.jobs.get(continueFromId);
        if (!parent) throw new Error(`continueWith parent job ${continueFromId} not found`);
        const chainIndex = parent.chainIndex + 1;

        const existing = idx.findExistingContinuation(parent.chainId, chainIndex);
        if (existing) return { job: existing, deduplicated: true };

        const id = providedId ?? generateId();
        const job = buildDbJob({
          id,
          typeName,
          chainId: parent.chainId,
          chainTypeName: parent.chainTypeName,
          chainIndex,
          deduplicationKey: null,
          input,
          schedule,
          chainTraceContext,
          traceContext,
        });

        idx.writeJob(journal, undefined, job);
        return { job, deduplicated: false };
      }),

    addJobsBlockers: async ({ txCtx, jobBlockers: jobBlockerInputs }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const results: {
          job: DbJob;
          incompleteBlockerChainIds: string[];
          blockerChainTraceContexts: (string | null)[];
        }[] = [];

        for (const { jobId, blockedByChainIds, blockerTraceContexts } of jobBlockerInputs) {
          const job = idx.jobs.get(jobId);
          if (!job) throw new Error("Job not found");

          blockedByChainIds.forEach((blockerChainId, index) => {
            const prev = idx.jobBlockers.get(jobId)?.get(blockerChainId);
            idx.writeBlocker(journal, jobId, blockerChainId, prev, {
              index,
              traceContext: blockerTraceContexts?.[index] ?? null,
            });
          });

          const incompleteBlockerChainIds: string[] = [];
          const blockerChainTraceContexts: (string | null)[] = [];
          for (const blockerChainId of blockedByChainIds) {
            const tailJob = idx.getLastJob(blockerChainId);
            if (!tailJob || !isChainCompleted(tailJob)) {
              incompleteBlockerChainIds.push(blockerChainId);
            }
            const headJob = idx.jobs.get(blockerChainId);
            blockerChainTraceContexts.push(headJob?.chainTraceContext ?? null);
          }

          if (incompleteBlockerChainIds.length > 0 && isRunnablePending(job)) {
            const updatedJob: DbJob = { ...job, blocked: true };
            idx.writeJob(journal, job, updatedJob);
            results.push({ job: updatedJob, incompleteBlockerChainIds, blockerChainTraceContexts });
          } else {
            results.push({ job, incompleteBlockerChainIds: [], blockerChainTraceContexts });
          }
        }

        return results;
      }),

    getJobBlockers: async ({ txCtx, jobId }) =>
      withReadLock(txCtx, () => {
        const blockerMap = idx.jobBlockers.get(jobId);
        if (!blockerMap) return [];

        return Array.from(blockerMap.entries())
          .sort((a, b) => a[1].index - b[1].index)
          .flatMap(([blockerChainId]) => {
            const headJob = idx.jobs.get(blockerChainId);
            if (!headJob) return [];
            return [chainPair(headJob)];
          });
      }),

    unblockJobs: async ({ txCtx, blockedByChainId }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const unblockedJobs: DbJob[] = [];
        const blockerTraceContexts: (string | null)[] = [];
        const now = new Date();

        const blockedJobIds = idx.blockedByChain.get(blockedByChainId);
        if (!blockedJobIds || blockedJobIds.size === 0) {
          return { unblockedJobs, blockerTraceContexts };
        }

        for (const jobId of Array.from(blockedJobIds)) {
          const blockerMap = idx.jobBlockers.get(jobId);
          if (!blockerMap) continue;
          const entry = blockerMap.get(blockedByChainId);
          if (!entry) continue;

          if (entry.traceContext != null) {
            blockerTraceContexts.push(entry.traceContext);
          }

          const job = idx.jobs.get(jobId);
          if (!job || !job.blocked) continue;

          let allComplete = true;
          for (const bChainId of blockerMap.keys()) {
            const tailJob = idx.getLastJob(bChainId);
            if (!tailJob || !isChainCompleted(tailJob)) {
              allComplete = false;
              break;
            }
          }

          if (allComplete) {
            const updatedJob: DbJob = {
              ...job,
              blocked: false,
              scheduledAt: clampToFloor(job.scheduledAt, now),
            };
            idx.writeJob(journal, job, updatedJob);
            unblockedJobs.push(updatedJob);
          }
        }

        return { unblockedJobs, blockerTraceContexts };
      }),

    startJobAttempt: async ({ txCtx, typeNames, workerId }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const now = new Date();
        const nowMs = now.getTime();

        let bestJob: DbJob | undefined;
        let bestSet: SortedSet<DbJob> | undefined;
        for (const typeName of typeNames) {
          const set = idx.pendingByType.get(typeName);
          const candidate = set?.first();
          if (!candidate) continue;
          if (candidate.scheduledAt.getTime() > nowMs) continue;
          if (!bestJob || idx.cmpScheduledAt(candidate, bestJob) < 0) {
            bestJob = candidate;
            bestSet = set;
          }
        }

        if (!bestJob || !bestSet) return { job: undefined, hasMore: false };

        let hasMore = false;
        const second = bestSet.at(1);
        if (second && second.scheduledAt.getTime() <= nowMs) hasMore = true;
        if (!hasMore) {
          for (const typeName of typeNames) {
            const set = idx.pendingByType.get(typeName);
            if (!set || set === bestSet) continue;
            const candidate = set.first();
            if (candidate && candidate.scheduledAt.getTime() <= nowMs) {
              hasMore = true;
              break;
            }
          }
        }

        const updatedJob: DbJob = {
          ...bestJob,
          attempt: bestJob.attempt + 1,
          attemptAt: now,
          attemptBy: workerId,
        };
        idx.writeJob(journal, bestJob, updatedJob);
        return { job: updatedJob, hasMore };
      }),

    extendJobAttempt: async ({ txCtx, jobId, workerId, timeoutMs }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const job = idx.jobs.get(jobId);
        if (!job || job.attemptBy !== workerId)
          throw new Error("Job not found or not owned by worker");

        const updatedJob: DbJob = { ...job, attemptUntil: new Date(Date.now() + timeoutMs) };
        idx.writeJob(journal, job, updatedJob);
        return updatedJob;
      }),

    finishJobAttempt: async ({ txCtx, jobId, workerId, outcome }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const job = idx.jobs.get(jobId);

        if (outcome.error !== undefined) {
          if (!job || !isRunning(job)) throw new Error("Job not found or not running");
          const now = new Date();
          const requestedScheduledAt =
            outcome.schedule?.at ??
            (outcome.schedule?.afterMs ? new Date(now.getTime() + outcome.schedule.afterMs) : now);
          const updatedJob: DbJob = {
            ...job,
            lastAttemptAt: now,
            lastAttemptError: outcome.error,
            attemptBy: null,
            attemptUntil: null,
            attemptAt: null,
            scheduledAt: clampToFloor(requestedScheduledAt, now),
          };
          idx.writeJob(journal, job, updatedJob);
          return updatedJob;
        }

        if (!job || job.completedAt !== null) throw new Error("Job not found or already completed");
        const continuedToId = outcome.continuedToId ?? null;
        const updatedJob: DbJob = {
          ...job,
          completedAt: new Date(),
          completedBy: workerId,
          output: continuedToId != null ? null : outcome.output,
          continuedToId,
          blocked: false,
          attemptBy: null,
          attemptUntil: null,
          attemptAt: null,
          lastAttemptError: null,
        };
        idx.writeJob(journal, job, updatedJob);
        return updatedJob;
      }),

    reclaimExpiredJobAttempt: async ({ txCtx, typeNames, ignoredJobIds }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const nowMs = Date.now();
        const ignoredSet = ignoredJobIds ? new Set(ignoredJobIds) : undefined;

        let candidateJob: DbJob | undefined;
        for (const typeName of typeNames) {
          const set = idx.runningByType.get(typeName);
          if (!set) continue;
          for (let i = 0; i < set.size; i++) {
            const job = set.at(i)!;
            if (!job.attemptUntil) break;
            const lu = job.attemptUntil.getTime();
            if (lu > nowMs) break;
            if (ignoredSet?.has(job.id)) continue;
            if (!candidateJob || lu < candidateJob.attemptUntil!.getTime()) candidateJob = job;
            break;
          }
        }

        if (!candidateJob) return undefined;

        const updatedJob: DbJob = {
          ...candidateJob,
          attemptBy: null,
          attemptUntil: null,
          attemptAt: null,
        };
        idx.writeJob(journal, candidateJob, updatedJob);
        return updatedJob;
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

    rescheduleJobs: async ({ txCtx, jobIds, schedule }) =>
      withWriteLock(txCtx, () => {
        if (jobIds.length === 0) return [];
        const journal = txCtx?.journal;
        const now = new Date();
        const requestedScheduledAt =
          schedule?.at ?? (schedule?.afterMs ? new Date(now.getTime() + schedule.afterMs) : now);
        const resolvedScheduledAt = clampToFloor(requestedScheduledAt, now);
        const rescheduled: StateJob[] = [];
        const seen = new Set<string>();
        for (const jobId of jobIds) {
          if (seen.has(jobId)) continue;
          seen.add(jobId);
          const job = idx.jobs.get(jobId);
          if (!job || !isPending(job)) continue;
          const updatedJob: DbJob = { ...job, scheduledAt: resolvedScheduledAt };
          idx.writeJob(journal, job, updatedJob);
          rescheduled.push(updatedJob);
        }
        return rescheduled;
      }),

    deleteChains: async ({ txCtx, chainIds, cascade }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const effectiveChainIds = cascade ? idx.expandChainIds(chainIds) : chainIds;

        const blockerRefs = idx.findExternalBlockerRefs(effectiveChainIds);
        if (blockerRefs.length > 0) return { deleted: [], blockerRefs };

        const deleted: [DbJob, DbJob | undefined][] = effectiveChainIds.flatMap((chainId) => {
          const headJob = idx.jobs.get(chainId);
          return headJob ? [chainPair(headJob)] : [];
        });

        const jobsToRemove: DbJob[] = [];
        for (const chainId of effectiveChainIds) {
          const chainMap = idx.jobsByChain.get(chainId);
          if (!chainMap) continue;
          for (const j of chainMap.values()) jobsToRemove.push(j);
        }

        for (const job of jobsToRemove) {
          const map = idx.jobBlockers.get(job.id);
          if (map) {
            for (const blockerChainId of Array.from(map.keys())) {
              idx.writeBlocker(journal, job.id, blockerChainId, map.get(blockerChainId), undefined);
            }
          }
          idx.writeJob(journal, job, undefined);
        }

        return { deleted, blockerRefs: [] };
      }),

    listChains: async ({
      txCtx,
      typeName,
      independent,
      chainId,
      from,
      to,
      status,
      orderBy,
      orderDirection,
      page,
    }) =>
      withReadLock(txCtx, () => {
        const idMatchChainIds = chainId ? new Set<string>(chainId) : undefined;
        const blockerChainIds =
          independent !== undefined ? new Set<string>(idx.blockedByChain.keys()) : undefined;

        const chains: [DbJob, DbJob | undefined][] = [];
        for (const job of idx.headJobsByCreatedAt.iterate("asc")) {
          const tailJob = idx.getLastJob(job.id);
          if (idMatchChainIds && !idMatchChainIds.has(job.chainId)) continue;
          if (blockerChainIds) {
            const isBlocker = blockerChainIds.has(job.chainId);
            if (independent === true && isBlocker) continue;
            if (independent === false && !isBlocker) continue;
          }
          if (!matchesTypeNameFilter(job, typeName)) continue;
          if (!matchesChainStatus(job, tailJob, status)) continue;
          if (!matchesDateRange(job.createdAt, from, to)) continue;
          chains.push([job, tailJob && tailJob.id !== job.id ? tailJob : undefined]);
        }

        return paginateByTimestamp(
          chains,
          page,
          orderDirection,
          orderBy,
          chainTimestampGetters[orderBy],
        );
      }),

    listJobs: async (params) =>
      withReadLock(params.txCtx, () => {
        const { typeName, chainTypeName, chainId, jobId, from, to, orderBy, orderDirection, page } =
          params;
        const status = params.status;
        const blocked = status === "pending" ? params.blocked : undefined;
        const continued = status === "completed" ? params.continued : undefined;

        const matched: DbJob[] = [];
        for (const job of idx.jobs.values()) {
          if (jobId && !jobId.includes(job.id)) continue;
          if (!matchesJobStatus(job, status, blocked, continued)) continue;
          if (!matchesTypeNameFilter(job, typeName)) continue;
          if (!matchesChainTypeNameFilter(job, chainTypeName)) continue;
          if (chainId && !chainId.includes(job.chainId)) continue;
          if (!matchesDateRange(job.createdAt, from, to)) continue;
          matched.push(job);
        }

        return paginateByTimestamp(
          matched,
          page,
          orderDirection,
          orderBy,
          jobTimestampGetters[orderBy],
        );
      }),

    listChainJobs: async ({ txCtx, chainId, orderDirection, page }) =>
      withReadLock(txCtx, () => {
        const chainMap = idx.jobsByChain.get(chainId);
        const matched: DbJob[] = chainMap ? Array.from(chainMap.values()) : [];
        return paginateByChainIndex(matched, idx.jobs, page, orderDirection);
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
        return paginateByTimestamp(
          matched,
          page,
          orderDirection,
          "createdAt",
          jobTimestampGetters.createdAt,
        );
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
