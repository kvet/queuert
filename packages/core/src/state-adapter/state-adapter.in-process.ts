import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type BlockerReference } from "../errors.js";
import { createAsyncRwLock } from "../helpers/async-rw-lock.js";
import { type OrderDirection, type Page, type PageParams } from "../pagination.js";
import { decodeCreatedAtWithIdCursor, decodeIdCursor, encodeCursor } from "./cursor.js";
import { createIdValidator } from "./id-validator.js";
import { type JobStatePredicate, type StateAdapter, type StateJob } from "./state-adapter.js";

type DbJob = Omit<StateJob, "scheduledInFuture"> & { chainIndex: number };

/** Ready or scheduled: not completed, not leased, not blocked. */
const isAcquirable = (job: DbJob): boolean =>
  job.completedAt === null && job.leasedUntil === null && !job.hasOpenBlockers;

/** Running: leased and not yet completed. */
const isRunning = (job: DbJob): boolean => job.completedAt === null && job.leasedUntil !== null;

/**
 * Projects a stored job into a {@link StateJob} read snapshot, evaluating the
 * clock-relative `scheduledInFuture` flag against `nowMs` at read time.
 */
const project = (job: DbJob, nowMs: number = Date.now()): StateJob => ({
  ...job,
  scheduledInFuture: job.scheduledAt.getTime() > nowMs,
});

const projectPair = (
  [root, last]: [DbJob, DbJob | undefined],
  nowMs: number = Date.now(),
): [StateJob, StateJob | undefined] => [
  project(root, nowMs),
  last ? project(last, nowMs) : undefined,
];

const projectJobPage = (page: Page<DbJob>, nowMs: number = Date.now()): Page<StateJob> => ({
  ...page,
  items: page.items.map((j) => project(j, nowMs)),
});

const projectPairPage = (
  page: Page<[DbJob, DbJob | undefined]>,
  nowMs: number = Date.now(),
): Page<[StateJob, StateJob | undefined]> => ({
  ...page,
  items: page.items.map((pair) => projectPair(pair, nowMs)),
});

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

export type InProcessContext = { inTransaction?: boolean; journal?: JournalEntry[] };

type Comparator<T> = (a: T, b: T) => number;

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

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const makeComparators = (
  seqByJobId: Map<string, number>,
): {
  scheduledAt: Comparator<DbJob>;
  leasedUntil: Comparator<DbJob>;
  createdAt: Comparator<DbJob>;
} => {
  const seq = (job: DbJob): number => seqByJobId.get(job.id) ?? 0;
  return {
    scheduledAt: (a, b) => {
      const d = a.scheduledAt.getTime() - b.scheduledAt.getTime();
      if (d !== 0) return d;
      const s = seq(a) - seq(b);
      return s !== 0 ? s : compareStrings(a.id, b.id);
    },
    leasedUntil: (a, b) => {
      const ax = a.leasedUntil ? a.leasedUntil.getTime() : Infinity;
      const bx = b.leasedUntil ? b.leasedUntil.getTime() : Infinity;
      const d = ax - bx;
      if (d !== 0) return d;
      const s = seq(a) - seq(b);
      return s !== 0 ? s : compareStrings(a.id, b.id);
    },
    createdAt: (a, b) => {
      const d = a.createdAt.getTime() - b.createdAt.getTime();
      if (d !== 0) return d;
      const s = seq(a) - seq(b);
      return s !== 0 ? s : compareStrings(a.id, b.id);
    },
  };
};

const matchesDateRange = (createdAt: Date, from?: Date, to?: Date): boolean => {
  if (from && createdAt < from) return false;
  if (to && createdAt > to) return false;
  return true;
};

const clampToFloor = (requested: Date, now: Date): Date =>
  requested.getTime() > now.getTime() ? requested : now;

export type InProcessStateAdapter = StateAdapter<InProcessContext, string>;

export const createInProcessStateAdapter = async ({
  generateId: generateIdOption = () => crypto.randomUUID(),
  validateId: validateIdOption,
}: {
  /** Function to generate new job IDs. @defaultValue `() => crypto.randomUUID()` */
  generateId?: () => string;
  /** Predicate returning `true` if the ID is acceptable. Runs on both generated and caller-supplied IDs. */
  validateId?: (id: string) => boolean;
} = {}): Promise<InProcessStateAdapter> => {
  const { validateId, generateId } = createIdValidator({ generateIdOption, validateIdOption });

  const jobs = new Map<string, DbJob>();
  const pendingByType = new Map<string, SortedSet<DbJob>>();
  const runningByType = new Map<string, SortedSet<DbJob>>();
  const jobsByChain = new Map<string, Map<number, DbJob>>();
  const lastByChain = new Map<string, DbJob>();
  const dedupByKey = new Map<string, Set<DbJob>>();
  const jobBlockers = new Map<string, Map<string, BlockerEntry>>();
  const blockedByChain = new Map<string, Set<string>>();

  const seqByJobId = new Map<string, number>();
  let nextSeq = 0;
  const cmp = makeComparators(seqByJobId);
  const rootJobsByCreatedAt = new SortedSet<DbJob>(cmp.createdAt);

  const lock = createAsyncRwLock();

  const dedupKey = (job: DbJob): string | undefined =>
    job.deduplicationKey != null ? `${job.chainTypeName}\u0000${job.deduplicationKey}` : undefined;

  const indexInsertJob = (job: DbJob): void => {
    if (!seqByJobId.has(job.id)) seqByJobId.set(job.id, nextSeq++);

    if (isAcquirable(job)) {
      let set = pendingByType.get(job.typeName);
      if (!set) {
        set = new SortedSet(cmp.scheduledAt);
        pendingByType.set(job.typeName, set);
      }
      set.insert(job);
    } else if (isRunning(job)) {
      let set = runningByType.get(job.typeName);
      if (!set) {
        set = new SortedSet(cmp.leasedUntil);
        runningByType.set(job.typeName, set);
      }
      set.insert(job);
    }

    let chainMap = jobsByChain.get(job.chainId);
    if (!chainMap) {
      chainMap = new Map();
      jobsByChain.set(job.chainId, chainMap);
    }
    chainMap.set(job.chainIndex, job);

    const last = lastByChain.get(job.chainId);
    if (!last || job.chainIndex > last.chainIndex) {
      lastByChain.set(job.chainId, job);
    }

    if (job.id === job.chainId) {
      rootJobsByCreatedAt.insert(job);
      const k = dedupKey(job);
      if (k) {
        let set = dedupByKey.get(k);
        if (!set) {
          set = new Set();
          dedupByKey.set(k, set);
        }
        set.add(job);
      }
    }
  };

  const indexRemoveJob = (job: DbJob): void => {
    if (isAcquirable(job)) {
      pendingByType.get(job.typeName)?.delete(job);
    } else if (isRunning(job)) {
      runningByType.get(job.typeName)?.delete(job);
    }

    const chainMap = jobsByChain.get(job.chainId);
    if (chainMap) {
      const stored = chainMap.get(job.chainIndex);
      if (stored && stored.id === job.id) {
        chainMap.delete(job.chainIndex);
        if (chainMap.size === 0) jobsByChain.delete(job.chainId);
      }
    }

    const last = lastByChain.get(job.chainId);
    if (last && last.id === job.id) {
      let newLast: DbJob | undefined;
      const remaining = jobsByChain.get(job.chainId);
      if (remaining) {
        for (const j of remaining.values()) {
          if (!newLast || j.chainIndex > newLast.chainIndex) newLast = j;
        }
      }
      if (newLast) lastByChain.set(job.chainId, newLast);
      else lastByChain.delete(job.chainId);
    }

    if (job.id === job.chainId) {
      rootJobsByCreatedAt.delete(job);
      const k = dedupKey(job);
      if (k) {
        const set = dedupByKey.get(k);
        if (set) {
          set.delete(job);
          if (set.size === 0) dedupByKey.delete(k);
        }
      }
    }
  };

  const writeJob = (
    journal: JournalEntry[] | undefined,
    prev: DbJob | undefined,
    next: DbJob | undefined,
  ): void => {
    if (prev) indexRemoveJob(prev);
    if (next) {
      jobs.set(next.id, next);
      indexInsertJob(next);
    } else if (prev) {
      jobs.delete(prev.id);
      seqByJobId.delete(prev.id);
    }
    if (journal) journal.push({ kind: "job", prev, next });
  };

  const writeBlocker = (
    journal: JournalEntry[] | undefined,
    jobId: string,
    blockerChainId: string,
    prev: BlockerEntry | undefined,
    next: BlockerEntry | undefined,
  ): void => {
    const map = jobBlockers.get(jobId);
    if (next) {
      if (map) {
        map.set(blockerChainId, next);
      } else {
        jobBlockers.set(jobId, new Map([[blockerChainId, next]]));
      }
      let inv = blockedByChain.get(blockerChainId);
      if (!inv) {
        inv = new Set();
        blockedByChain.set(blockerChainId, inv);
      }
      inv.add(jobId);
    } else if (map) {
      map.delete(blockerChainId);
      if (map.size === 0) jobBlockers.delete(jobId);
      const inv = blockedByChain.get(blockerChainId);
      if (inv) {
        inv.delete(jobId);
        if (inv.size === 0) blockedByChain.delete(blockerChainId);
      }
    }
    if (journal) journal.push({ kind: "blocker", jobId, blockerChainId, prev, next });
  };

  const rollbackTo = (journal: JournalEntry[], target: number): void => {
    while (journal.length > target) {
      const entry = journal.pop()!;
      if (entry.kind === "job") {
        if (entry.next) indexRemoveJob(entry.next);
        if (entry.prev) {
          jobs.set(entry.prev.id, entry.prev);
          indexInsertJob(entry.prev);
        } else if (entry.next) {
          jobs.delete(entry.next.id);
          seqByJobId.delete(entry.next.id);
        }
      } else {
        const map = jobBlockers.get(entry.jobId);
        if (entry.prev) {
          if (map) {
            map.set(entry.blockerChainId, entry.prev);
          } else {
            jobBlockers.set(entry.jobId, new Map([[entry.blockerChainId, entry.prev]]));
          }
          let inv = blockedByChain.get(entry.blockerChainId);
          if (!inv) {
            inv = new Set();
            blockedByChain.set(entry.blockerChainId, inv);
          }
          inv.add(entry.jobId);
        } else if (map) {
          map.delete(entry.blockerChainId);
          if (map.size === 0) jobBlockers.delete(entry.jobId);
          const inv = blockedByChain.get(entry.blockerChainId);
          if (inv) {
            inv.delete(entry.jobId);
            if (inv.size === 0) blockedByChain.delete(entry.blockerChainId);
          }
        }
      }
    }
  };

  const getLastJobInChain = (chainId: string): DbJob | undefined => lastByChain.get(chainId);

  const expandChainIds = (chainIds: readonly string[]): string[] => {
    const visited = new Set(chainIds);
    const queue = [...chainIds];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const blockerMap = jobBlockers.get(current);
      if (!blockerMap) continue;
      for (const blockerChainId of blockerMap.keys()) {
        if (!visited.has(blockerChainId)) {
          visited.add(blockerChainId);
          queue.push(blockerChainId);
        }
      }
    }
    return [...visited];
  };

  const findExternalBlockerRefs = (effectiveChainIds: readonly string[]): BlockerReference[] => {
    const chainIdSet = new Set(effectiveChainIds);
    const refs: BlockerReference[] = [];
    for (const chainId of effectiveChainIds) {
      const referencingJobIds = blockedByChain.get(chainId);
      if (!referencingJobIds) continue;
      for (const refJobId of referencingJobIds) {
        const refJob = jobs.get(refJobId);
        if (!refJob) continue;
        if (chainIdSet.has(refJob.chainId)) continue;
        refs.push({ chainId, referencedByJobId: refJobId });
      }
    }
    return refs;
  };

  const findExistingContinuation = (chainId: string, chainIndex: number): DbJob | undefined => {
    const chainMap = jobsByChain.get(chainId);
    if (!chainMap) return undefined;
    const candidate = chainMap.get(chainIndex);
    if (!candidate) return undefined;
    if (candidate.id === candidate.chainId) return undefined;
    return candidate;
  };

  const findDeduplicatedJob = (
    chainTypeName: string,
    deduplication: DeduplicationOptions<string>,
  ): DbJob | undefined => {
    if (!deduplication.key) return undefined;

    const set = dedupByKey.get(`${chainTypeName}\u0000${deduplication.key}`);
    if (!set || set.size === 0) return undefined;

    const now = Date.now();
    const scope = deduplication.scope ?? "open";
    const exclude = deduplication.excludeChainIds
      ? new Set(deduplication.excludeChainIds)
      : undefined;
    const windowStart =
      deduplication.windowMs !== undefined ? now - deduplication.windowMs : undefined;

    let bestMatch: DbJob | undefined;
    for (const job of set) {
      if (exclude?.has(job.chainId)) continue;
      if (scope === "open" && job.completedAt !== null) continue;
      if (windowStart !== undefined && job.createdAt.getTime() < windowStart) continue;
      if (!bestMatch || job.createdAt > bestMatch.createdAt) bestMatch = job;
    }
    return bestMatch;
  };

  const matchesStatePredicate = (job: DbJob, p: JobStatePredicate, now: Date): boolean => {
    if (p.completed !== undefined && (job.completedAt !== null) !== p.completed) return false;
    if (p.succeeded !== undefined && (job.continuedToJobId !== null) !== p.succeeded) return false;
    if (p.leased !== undefined && (job.leasedUntil !== null) !== p.leased) return false;
    if (p.hasOpenBlockers !== undefined && job.hasOpenBlockers !== p.hasOpenBlockers) return false;
    if (
      p.scheduledInFuture !== undefined &&
      job.scheduledAt.getTime() > now.getTime() !== p.scheduledInFuture
    ) {
      return false;
    }
    return true;
  };

  const matchesStatePredicates = (
    job: DbJob,
    predicates: JobStatePredicate[] | undefined,
    now: Date,
  ): boolean =>
    !predicates ||
    predicates.length === 0 ||
    predicates.some((p) => matchesStatePredicate(job, p, now));

  const matchesTypeNameFilter = (job: DbJob, typeNames?: string[]): boolean =>
    !typeNames || typeNames.length === 0 || typeNames.includes(job.typeName);

  const matchesChainTypeNameFilter = (job: DbJob, chainTypeNames?: string[]): boolean =>
    !chainTypeNames || chainTypeNames.length === 0 || chainTypeNames.includes(job.chainTypeName);

  const paginateByCreatedAt = <T extends DbJob | [DbJob, DbJob | undefined]>(
    items: T[],
    page: PageParams,
    orderDirection: OrderDirection,
  ): Page<T> => {
    const getId = (item: T): string => (Array.isArray(item) ? item[0].id : item.id);
    const getCreatedAt = (item: T): Date =>
      Array.isArray(item) ? item[0].createdAt : item.createdAt;

    const dir = orderDirection === "desc" ? -1 : 1;
    const sorted = items.toSorted((a, b) => {
      const d = getCreatedAt(a).getTime() - getCreatedAt(b).getTime();
      if (d !== 0) return d * dir;
      const idA = getId(a);
      const idB = getId(b);
      return idA < idB ? -dir : idA > idB ? dir : 0;
    });

    let startIndex = 0;
    if (page.cursor) {
      const cursor = decodeCreatedAtWithIdCursor(page.cursor);
      startIndex = sorted.findIndex((item) => {
        const sv = getCreatedAt(item).toISOString();
        const id = getId(item);
        if (orderDirection === "desc") {
          return sv < cursor.createdAt || (sv === cursor.createdAt && id < cursor.id);
        }
        return sv > cursor.createdAt || (sv === cursor.createdAt && id > cursor.id);
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
              type: "createdAtWithId",
              id: getId(lastItem),
              createdAt: getCreatedAt(lastItem).toISOString(),
            })
          : null,
    };
  };

  const paginateByChainIndex = (
    items: DbJob[],
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
      const cursorJob = jobs.get(cursor.id);
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

  const clearAll = (): void => {
    jobs.clear();
    pendingByType.clear();
    runningByType.clear();
    jobsByChain.clear();
    lastByChain.clear();
    dedupByKey.clear();
    jobBlockers.clear();
    blockedByChain.clear();
    rootJobsByCreatedAt.clear();
    seqByJobId.clear();
  };

  const adapter: InProcessStateAdapter = {
    withTransaction: async (fn) => {
      using _h = await lock.acquireWrite();
      assertOpen();
      const journal: JournalEntry[] = [];
      const txCtx: InProcessContext = { inTransaction: true, journal };
      try {
        return await fn(txCtx);
      } catch (error) {
        rollbackTo(journal, 0);
        throw error;
      }
    },

    withSavepoint: async (txCtx, fn) => {
      if (!txCtx.journal) {
        throw new Error("withSavepoint called outside a transaction");
      }
      const journal = txCtx.journal;
      const start = journal.length;
      try {
        return await fn(txCtx);
      } catch (error) {
        rollbackTo(journal, start);
        throw error;
      }
    },

    getChain: async ({ txCtx, chainId }) =>
      withReadLock(txCtx, () => {
        const rootJob = jobs.get(chainId);
        if (!rootJob) return undefined;
        const lastJob = getLastJobInChain(chainId);
        return projectPair([rootJob, lastJob && lastJob.id !== rootJob.id ? lastJob : undefined]);
      }),

    getJob: async ({ txCtx, jobId }) =>
      withReadLock(txCtx, () => {
        const job = jobs.get(jobId);
        return job ? project(job) : undefined;
      }),

    createJobs: async ({ txCtx, jobs: jobInputs }) =>
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
          } = jobInput;

          let chainId: string;
          let chainTypeName: string;
          let chainIndex: number;
          let parent: DbJob | undefined;
          let deduplication: DeduplicationOptions<string> | undefined;

          if ("continueFromJobId" in jobInput) {
            parent = jobs.get(jobInput.continueFromJobId);
            if (!parent) {
              throw new Error(`continueWith parent job ${jobInput.continueFromJobId} not found`);
            }
            chainId = parent.chainId;
            chainTypeName = parent.chainTypeName;
            chainIndex = parent.chainIndex + 1;

            const existingContinuation = findExistingContinuation(chainId, chainIndex);
            if (existingContinuation) {
              results.push({ job: existingContinuation, deduplicated: true });
              continue;
            }
          } else {
            chainTypeName = jobInput.chainTypeName;
            chainIndex = 0;
            chainId = ""; // assigned below from generated id
            deduplication = jobInput.deduplication;
            if (deduplication) {
              const existingDeduplicated = findDeduplicatedJob(chainTypeName, deduplication);
              if (existingDeduplicated) {
                results.push({ job: existingDeduplicated, deduplicated: true });
                continue;
              }
            }
          }

          const id = providedId ?? generateId();
          if (!parent) chainId = id;

          const now = new Date();
          const requestedScheduledAt =
            schedule?.at ?? (schedule?.afterMs ? new Date(now.getTime() + schedule.afterMs) : now);
          const resolvedScheduledAt = clampToFloor(requestedScheduledAt, now);

          const job: DbJob = {
            id,
            typeName,
            chainTypeName,
            chainIndex,
            continuedToJobId: null,
            hasOpenBlockers: false,
            input,
            output: null,
            chainId,
            createdAt: now,
            scheduledAt: resolvedScheduledAt,
            completedAt: null,
            completedBy: null,
            attempt: 0,
            lastAttemptError: null,
            lastAttemptAt: null,
            leasedBy: null,
            leasedUntil: null,
            deduplicationKey: deduplication?.key ?? null,
            chainTraceContext: chainTraceContext ?? null,
            traceContext: traceContext ?? null,
          };

          writeJob(journal, undefined, job);

          if (parent && parent.continuedToJobId === null) {
            const updatedParent: DbJob = { ...parent, continuedToJobId: job.id };
            writeJob(journal, parent, updatedParent);
          }

          results.push({ job, deduplicated: false });
        }
        return results.map((r) => ({ job: project(r.job), deduplicated: r.deduplicated }));
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
          const job = jobs.get(jobId);
          if (!job) throw new Error("Job not found");

          blockedByChainIds.forEach((blockerChainId, index) => {
            const prev = jobBlockers.get(jobId)?.get(blockerChainId);
            writeBlocker(journal, jobId, blockerChainId, prev, {
              index,
              traceContext: blockerTraceContexts?.[index] ?? null,
            });
          });

          const incompleteBlockerChainIds: string[] = [];
          const blockerChainTraceContexts: (string | null)[] = [];
          for (const blockerChainId of blockedByChainIds) {
            const lastJob = getLastJobInChain(blockerChainId);
            if (!lastJob || lastJob.completedAt === null) {
              incompleteBlockerChainIds.push(blockerChainId);
            }
            const rootJob = jobs.get(blockerChainId);
            blockerChainTraceContexts.push(rootJob?.chainTraceContext ?? null);
          }

          if (incompleteBlockerChainIds.length > 0 && isAcquirable(job)) {
            const updatedJob: DbJob = { ...job, hasOpenBlockers: true };
            writeJob(journal, job, updatedJob);
            results.push({
              job: updatedJob,
              incompleteBlockerChainIds,
              blockerChainTraceContexts,
            });
          } else {
            results.push({ job, incompleteBlockerChainIds: [], blockerChainTraceContexts });
          }
        }

        return results.map((r) => ({ ...r, job: project(r.job) }));
      }),

    unblockJobs: async ({ txCtx, blockedByChainId }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const unblockedJobs: DbJob[] = [];
        const blockerTraceContexts: (string | null)[] = [];
        const now = new Date();

        const blockedJobIds = blockedByChain.get(blockedByChainId);
        if (!blockedJobIds || blockedJobIds.size === 0) {
          return { unblockedJobs: unblockedJobs.map((j) => project(j)), blockerTraceContexts };
        }

        const candidateJobIds = Array.from(blockedJobIds);
        for (const jobId of candidateJobIds) {
          const blockerMap = jobBlockers.get(jobId);
          if (!blockerMap) continue;
          const entry = blockerMap.get(blockedByChainId);
          if (!entry) continue;

          if (entry.traceContext != null) {
            blockerTraceContexts.push(entry.traceContext);
          }

          const job = jobs.get(jobId);
          if (!job || !job.hasOpenBlockers) continue;

          let allComplete = true;
          for (const blockerChainId of blockerMap.keys()) {
            const lastJob = getLastJobInChain(blockerChainId);
            if (!lastJob || lastJob.completedAt === null) {
              allComplete = false;
              break;
            }
          }

          if (allComplete) {
            const updatedJob: DbJob = {
              ...job,
              hasOpenBlockers: false,
              scheduledAt: clampToFloor(job.scheduledAt, now),
            };
            writeJob(journal, job, updatedJob);
            unblockedJobs.push(updatedJob);
          }
        }

        return { unblockedJobs: unblockedJobs.map((j) => project(j)), blockerTraceContexts };
      }),

    getJobBlockers: async ({ txCtx, jobId }) =>
      withReadLock(txCtx, () => {
        const blockerMap = jobBlockers.get(jobId);
        if (!blockerMap) return [];

        const entries = Array.from(blockerMap.entries()).sort((a, b) => a[1].index - b[1].index);

        const result: [DbJob, DbJob | undefined][] = [];
        for (const [blockerChainId] of entries) {
          const rootJob = jobs.get(blockerChainId);
          if (!rootJob) continue;

          const lastJob = getLastJobInChain(blockerChainId);
          result.push([rootJob, lastJob && lastJob.id !== rootJob.id ? lastJob : undefined]);
        }

        return result.map((pair) => projectPair(pair));
      }),

    getNextJobAvailableInMs: async ({ txCtx, typeNames }) =>
      withReadLock(txCtx, () => {
        const now = Date.now();
        let nextScheduledAt: number | null = null;

        for (const typeName of typeNames) {
          const set = pendingByType.get(typeName);
          const candidate = set?.first();
          if (!candidate) continue;
          const t = candidate.scheduledAt.getTime();
          if (nextScheduledAt === null || t < nextScheduledAt) nextScheduledAt = t;
        }

        if (nextScheduledAt === null) return null;
        return Math.max(0, nextScheduledAt - now);
      }),

    acquireJob: async ({ txCtx, typeNames, workerId, leaseDurationMs }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const now = new Date();
        const nowMs = now.getTime();

        let bestJob: DbJob | undefined;
        let bestSet: SortedSet<DbJob> | undefined;
        for (const typeName of typeNames) {
          const set = pendingByType.get(typeName);
          const candidate = set?.first();
          if (!candidate) continue;
          if (candidate.scheduledAt.getTime() > nowMs) continue;
          if (!bestJob || cmp.scheduledAt(candidate, bestJob) < 0) {
            bestJob = candidate;
            bestSet = set;
          }
        }

        if (!bestJob || !bestSet) {
          return { job: undefined, hasMore: false };
        }

        let hasMore = false;
        const second = bestSet.at(1);
        if (second && second.scheduledAt.getTime() <= nowMs) hasMore = true;
        if (!hasMore) {
          for (const typeName of typeNames) {
            const set = pendingByType.get(typeName);
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
          leasedBy: workerId,
          leasedUntil: new Date(nowMs + leaseDurationMs),
          attempt: bestJob.attempt + 1,
        };
        writeJob(journal, bestJob, updatedJob);

        return { job: project(updatedJob, nowMs), hasMore };
      }),

    renewJobLease: async ({ txCtx, jobId, workerId, leaseDurationMs }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const job = jobs.get(jobId);
        if (!job) throw new Error("Job not found");

        const now = new Date();
        const updatedJob: DbJob = {
          ...job,
          leasedBy: workerId,
          leasedUntil: new Date(now.getTime() + leaseDurationMs),
        };

        writeJob(journal, job, updatedJob);
        return project(updatedJob, now.getTime());
      }),

    rescheduleJob: async ({ txCtx, jobId, schedule, error }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const job = jobs.get(jobId);
        if (!job) throw new Error("Job not found");

        const now = new Date();
        const requestedScheduledAt =
          schedule.at ?? (schedule.afterMs ? new Date(now.getTime() + schedule.afterMs) : now);
        const resolvedScheduledAt = clampToFloor(requestedScheduledAt, now);
        const updatedJob: DbJob = {
          ...job,
          scheduledAt: resolvedScheduledAt,
          lastAttemptAt: now,
          lastAttemptError: error,
          leasedBy: null,
          leasedUntil: null,
        };

        writeJob(journal, job, updatedJob);
        return project(updatedJob, now.getTime());
      }),

    completeJob: async ({ txCtx, jobId, output, workerId }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const job = jobs.get(jobId);
        if (!job) throw new Error("Job not found");

        const now = new Date();
        const updatedJob: DbJob = {
          ...job,
          completedAt: now,
          completedBy: workerId,
          output,
          leasedBy: null,
          leasedUntil: null,
          lastAttemptError: null,
        };

        writeJob(journal, job, updatedJob);
        return project(updatedJob, now.getTime());
      }),

    reapExpiredJobLease: async ({ txCtx, typeNames, ignoredJobIds }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const now = new Date();
        const nowMs = now.getTime();
        const ignoredSet = ignoredJobIds ? new Set(ignoredJobIds) : undefined;

        let candidateJob: DbJob | undefined;
        for (const typeName of typeNames) {
          const set = runningByType.get(typeName);
          if (!set) continue;
          for (let i = 0; i < set.size; i++) {
            const job = set.at(i)!;
            // Running set sorts unleased jobs (leasedUntil=null → Infinity) after all leased
            // ones, so encountering either a future lease or an unleased job means no more
            // expired candidates in this set.
            if (!job.leasedUntil) break;
            const lu = job.leasedUntil.getTime();
            if (lu > nowMs) break;
            if (ignoredSet?.has(job.id)) continue;
            if (!candidateJob || lu < candidateJob.leasedUntil!.getTime()) candidateJob = job;
            break;
          }
        }

        if (!candidateJob) return undefined;

        const updatedJob: DbJob = {
          ...candidateJob,
          leasedBy: null,
          leasedUntil: null,
        };
        writeJob(journal, candidateJob, updatedJob);

        return project(updatedJob, nowMs);
      }),

    deleteChains: async ({ txCtx, chainIds, cascade }) =>
      withWriteLock(txCtx, () => {
        const journal = txCtx?.journal;
        const effectiveChainIds = cascade ? expandChainIds(chainIds) : chainIds;

        const blockerRefs = findExternalBlockerRefs(effectiveChainIds);
        if (blockerRefs.length > 0) return { deleted: [], blockerRefs };

        const deleted: [DbJob, DbJob | undefined][] = effectiveChainIds.flatMap((chainId) => {
          const rootJob = jobs.get(chainId);
          if (!rootJob) return [];
          const lastJob = getLastJobInChain(chainId);
          return [[rootJob, lastJob && lastJob.id !== rootJob.id ? lastJob : undefined]];
        });

        const jobsToRemove: DbJob[] = [];
        for (const chainId of effectiveChainIds) {
          const chainMap = jobsByChain.get(chainId);
          if (!chainMap) continue;
          for (const j of chainMap.values()) jobsToRemove.push(j);
        }

        for (const job of jobsToRemove) {
          const map = jobBlockers.get(job.id);
          if (map) {
            for (const blockerChainId of Array.from(map.keys())) {
              writeBlocker(journal, job.id, blockerChainId, map.get(blockerChainId), undefined);
            }
          }
          writeJob(journal, job, undefined);
        }

        return { deleted: deleted.map((pair) => projectPair(pair)), blockerRefs: [] };
      }),

    listChains: async ({ txCtx, filter, orderDirection, page }) =>
      withReadLock(txCtx, () => {
        const idMatchChainIds = filter?.chainId ? new Set<string>(filter.chainId) : undefined;

        let jobIdMatchChainIds: Set<string> | undefined;
        if (filter?.jobId) {
          jobIdMatchChainIds = new Set<string>();
          for (const j of jobs.values()) {
            if (filter.jobId.includes(j.id)) jobIdMatchChainIds.add(j.chainId);
          }
        }

        let blockerChainIds: Set<string> | undefined;
        if (filter?.rootOnly) {
          blockerChainIds = new Set<string>(blockedByChain.keys());
        }

        const chains: [DbJob, DbJob | undefined][] = [];
        for (const job of rootJobsByCreatedAt.iterate("asc")) {
          const lastJob = getLastJobInChain(job.id);
          const tail = lastJob ?? job;

          if (idMatchChainIds && !idMatchChainIds.has(job.chainId)) continue;
          if (jobIdMatchChainIds && !jobIdMatchChainIds.has(job.chainId)) continue;
          if (blockerChainIds && blockerChainIds.has(job.chainId)) continue;
          if (!matchesTypeNameFilter(job, filter?.typeName)) continue;
          if (filter?.closed !== undefined && (tail.completedAt !== null) !== filter.closed)
            continue;
          if (!matchesDateRange(job.createdAt, filter?.from, filter?.to)) continue;

          chains.push([job, lastJob && lastJob.id !== job.id ? lastJob : undefined]);
        }

        return projectPairPage(paginateByCreatedAt(chains, page, orderDirection));
      }),

    listJobs: async ({ txCtx, filter, orderDirection, page }) =>
      withReadLock(txCtx, () => {
        const now = new Date();
        const matched: DbJob[] = [];
        for (const job of jobs.values()) {
          if (filter?.jobId && !filter.jobId.includes(job.id)) continue;
          if (!matchesStatePredicates(job, filter?.statePredicates, now)) continue;
          if (!matchesTypeNameFilter(job, filter?.typeName)) continue;
          if (!matchesChainTypeNameFilter(job, filter?.chainTypeName)) continue;
          if (filter?.chainId && !filter.chainId.includes(job.chainId)) continue;
          if (!matchesDateRange(job.createdAt, filter?.from, filter?.to)) continue;
          matched.push(job);
        }

        return projectJobPage(paginateByCreatedAt(matched, page, orderDirection));
      }),

    listChainJobs: async ({ txCtx, chainId, orderDirection, page }) =>
      withReadLock(txCtx, () => {
        const chainMap = jobsByChain.get(chainId);
        const matched: DbJob[] = chainMap ? Array.from(chainMap.values()) : [];
        return projectJobPage(paginateByChainIndex(matched, page, orderDirection));
      }),

    triggerJobs: async ({ txCtx, jobIds }) =>
      withWriteLock(txCtx, () => {
        if (jobIds.length === 0) return { triggered: [], notFound: [], notTriggerable: [] };

        const notFound: string[] = [];
        const notTriggerable: DbJob[] = [];
        const eligible: DbJob[] = [];
        const seen = new Set<string>();
        for (const jobId of jobIds) {
          if (seen.has(jobId)) continue;
          seen.add(jobId);
          const job = jobs.get(jobId);
          if (!job) notFound.push(jobId);
          else if (!isAcquirable(job)) notTriggerable.push(job);
          else eligible.push(job);
        }

        if (notFound.length > 0 || notTriggerable.length > 0) {
          return { triggered: [], notFound, notTriggerable: notTriggerable.map((j) => project(j)) };
        }

        const journal = txCtx?.journal;
        const now = new Date();
        const updatedById = new Map<string, DbJob>();
        for (const job of eligible) {
          const updatedJob: DbJob = { ...job, scheduledAt: now };
          writeJob(journal, job, updatedJob);
          updatedById.set(job.id, updatedJob);
        }

        const triggered: DbJob[] = [];
        const emitted = new Set<string>();
        for (const jobId of jobIds) {
          if (emitted.has(jobId)) continue;
          emitted.add(jobId);
          const job = updatedById.get(jobId);
          if (job) triggered.push(job);
        }
        return {
          triggered: triggered.map((j) => project(j, now.getTime())),
          notFound: [],
          notTriggerable: [],
        };
      }),

    listBlockedJobs: async ({ txCtx, chainId, orderDirection, page }) =>
      withReadLock(txCtx, () => {
        const blockedJobIds = blockedByChain.get(chainId);
        const matched: DbJob[] = [];
        if (blockedJobIds) {
          for (const jobId of blockedJobIds) {
            const job = jobs.get(jobId);
            if (job) matched.push(job);
          }
        }
        return projectJobPage(paginateByCreatedAt(matched, page, orderDirection));
      }),

    close: async () => {
      using _h = await lock.acquireWrite();
      if (closed) return;
      closed = true;
      clearAll();
    },
  };

  return adapter;
};
