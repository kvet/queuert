import { createAsyncLock } from "../helpers/async-lock.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import {
  type DeduplicationOptions,
  type Page,
  type PageParams,
  type StateAdapter,
  type StateJob,
  type StateJobStatus,
} from "./state-adapter.js";

export type InProcessContext = { inTransaction?: boolean };

type InProcessStore = {
  jobs: Map<string, StateJob>;
  jobBlockers: Map<string, Map<string, number>>;
};

const deepCloneStore = (store: InProcessStore): InProcessStore => ({
  jobs: new Map(Array.from(store.jobs).map(([k, v]) => [k, { ...v }])),
  jobBlockers: new Map(Array.from(store.jobBlockers).map(([k, v]) => [k, new Map(v)])),
});

export type InProcessStateAdapter = StateAdapter<InProcessContext, string>;

export const createInProcessStateAdapter = (): InProcessStateAdapter => {
  const store: InProcessStore = {
    jobs: new Map(),
    jobBlockers: new Map(),
  };

  const lock = createAsyncLock();

  const paginate = <T extends StateJob>(items: T[], page: PageParams): Page<T> => {
    const sorted = items.sort((a, b) => {
      const d = b.createdAt.getTime() - a.createdAt.getTime();
      if (d !== 0) return d;
      return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
    });

    let startIndex = 0;
    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      startIndex = sorted.findIndex((item) => {
        const sv = item.createdAt.toISOString();
        return sv < cursor.createdAt || (sv === cursor.createdAt && item.id < cursor.id);
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
          ? encodeCursor({ id: lastItem.id, createdAt: lastItem.createdAt.toISOString() })
          : null,
    };
  };

  const matchesStatusFilter = (job: StateJob, statuses?: StateJobStatus[]): boolean =>
    !statuses || statuses.length === 0 || statuses.includes(job.status);

  const matchesTypeNameFilter = (job: StateJob, typeNames?: string[]): boolean =>
    !typeNames || typeNames.length === 0 || typeNames.includes(job.typeName);

  const getLastJobInChain = (chainId: string): StateJob | undefined => {
    let lastJob: StateJob | undefined;
    for (const job of store.jobs.values()) {
      if (job.chainId === chainId) {
        if (!lastJob || job.createdAt >= lastJob.createdAt) {
          lastJob = job;
        }
      }
    }
    return lastJob;
  };

  const findExistingContinuation = (
    chainId: string | undefined,
    originId: string | undefined,
  ): StateJob | undefined => {
    if (!chainId || !originId) return undefined;
    for (const job of store.jobs.values()) {
      if (job.chainId === chainId && job.originId === originId) {
        return job;
      }
    }
    return undefined;
  };

  const findDeduplicatedJob = (deduplication: DeduplicationOptions): StateJob | undefined => {
    if (!deduplication.key) return undefined;

    let bestMatch: StateJob | undefined;
    const now = Date.now();
    const scope = deduplication.scope ?? "incomplete";

    for (const job of store.jobs.values()) {
      if (job.deduplicationKey !== deduplication.key) continue;
      if (job.id !== job.chainId) continue; // Only first jobs in chain

      if (scope === "incomplete" && job.status === "completed") continue;

      if (deduplication.windowMs !== undefined) {
        const windowStart = now - deduplication.windowMs;
        if (job.createdAt.getTime() < windowStart) continue;
      }

      if (!bestMatch || job.createdAt > bestMatch.createdAt) {
        bestMatch = job;
      }
    }

    return bestMatch;
  };

  return {
    runInTransaction: async (fn) => {
      await lock.acquire();

      const snapshot = deepCloneStore(store);
      const txContext: InProcessContext = { inTransaction: true };

      try {
        return await fn(txContext);
      } catch (error) {
        store.jobs = snapshot.jobs;
        store.jobBlockers = snapshot.jobBlockers;
        throw error;
      } finally {
        lock.release();
      }
    },

    getJobChainById: async ({ jobId }) => {
      const rootJob = store.jobs.get(jobId);
      if (!rootJob) return undefined;

      const lastJob = getLastJobInChain(jobId);
      return [rootJob, lastJob?.id !== rootJob.id ? lastJob : undefined];
    },

    getJobById: async ({ jobId }) => {
      return store.jobs.get(jobId);
    },

    createJob: async ({
      typeName,
      chainTypeName,
      input,
      rootChainId,
      chainId,
      originId,
      deduplication,
      schedule,
      traceContext,
    }) => {
      const existingContinuation = findExistingContinuation(chainId, originId);
      if (existingContinuation) {
        return { job: existingContinuation, deduplicated: true };
      }

      if (deduplication) {
        const existingDeduplicated = findDeduplicatedJob(deduplication);
        if (existingDeduplicated) {
          return { job: existingDeduplicated, deduplicated: true };
        }
      }

      const id = crypto.randomUUID();
      const now = new Date();
      const resolvedScheduledAt =
        schedule?.at ?? (schedule?.afterMs ? new Date(now.getTime() + schedule.afterMs) : now);

      const job: StateJob = {
        id,
        typeName,
        chainTypeName,
        input,
        output: null,
        rootChainId: rootChainId ?? id,
        chainId: chainId ?? id,
        originId: originId ?? null,
        status: "pending",
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
        traceContext: traceContext ?? null,
      };

      store.jobs.set(id, job);
      return { job, deduplicated: false };
    },

    addJobBlockers: async ({ jobId, blockedByChainIds, rootChainId, originId }) => {
      const job = store.jobs.get(jobId);
      if (!job) throw new Error("Job not found");

      const blockerChainIdSet = new Set(blockedByChainIds);

      // Post-hoc update: set rootChainId/originId on blocker chain jobs
      for (const existingJob of store.jobs.values()) {
        if (
          blockerChainIdSet.has(existingJob.chainId) &&
          existingJob.rootChainId === existingJob.chainId
        ) {
          store.jobs.set(existingJob.id, { ...existingJob, rootChainId });
        }
      }
      for (const blockerChainId of blockedByChainIds) {
        const starterJob = store.jobs.get(blockerChainId);
        if (starterJob && starterJob.originId === null) {
          store.jobs.set(blockerChainId, { ...starterJob, originId });
        }
      }

      const blockerMap = store.jobBlockers.get(jobId) ?? new Map<string, number>();
      blockedByChainIds.forEach((blockerChainId, index) => {
        blockerMap.set(blockerChainId, index);
      });
      store.jobBlockers.set(jobId, blockerMap);

      const incompleteBlockerChainIds: string[] = [];
      for (const blockerChainId of blockedByChainIds) {
        const lastJob = getLastJobInChain(blockerChainId);
        if (!lastJob || lastJob.status !== "completed") {
          incompleteBlockerChainIds.push(blockerChainId);
        }
      }

      if (incompleteBlockerChainIds.length > 0 && job.status === "pending") {
        const updatedJob: StateJob = { ...job, status: "blocked" };
        store.jobs.set(jobId, updatedJob);
        return { job: updatedJob, incompleteBlockerChainIds };
      }

      return { job, incompleteBlockerChainIds: [] };
    },

    scheduleBlockedJobs: async ({ blockedByChainId }) => {
      const scheduledJobs: StateJob[] = [];
      const now = new Date();

      for (const [jobId, blockerMap] of store.jobBlockers) {
        if (!blockerMap.has(blockedByChainId)) continue;

        const job = store.jobs.get(jobId);
        if (!job || job.status !== "blocked") continue;

        let allComplete = true;
        for (const blockerChainId of blockerMap.keys()) {
          const lastJob = getLastJobInChain(blockerChainId);
          if (!lastJob || lastJob.status !== "completed") {
            allComplete = false;
            break;
          }
        }

        if (allComplete) {
          const updatedJob: StateJob = {
            ...job,
            status: "pending",
            scheduledAt: now,
          };
          store.jobs.set(jobId, updatedJob);
          scheduledJobs.push(updatedJob);
        }
      }

      return scheduledJobs;
    },

    getJobBlockers: async ({ jobId }) => {
      const blockerMap = store.jobBlockers.get(jobId);
      if (!blockerMap) return [];

      const entries = Array.from(blockerMap.entries()).sort((a, b) => a[1] - b[1]);

      const result: [StateJob, StateJob | undefined][] = [];
      for (const [blockerChainId] of entries) {
        const rootJob = store.jobs.get(blockerChainId);
        if (!rootJob) continue;

        const lastJob = getLastJobInChain(blockerChainId);
        result.push([rootJob, lastJob?.id !== rootJob.id ? lastJob : undefined]);
      }

      return result;
    },

    getNextJobAvailableInMs: async ({ typeNames }) => {
      const now = Date.now();
      let nextScheduledAt: number | null = null;

      for (const job of store.jobs.values()) {
        if (!typeNames.includes(job.typeName)) continue;
        if (job.status !== "pending") continue;

        const scheduledAt = job.scheduledAt.getTime();
        if (nextScheduledAt === null || scheduledAt < nextScheduledAt) {
          nextScheduledAt = scheduledAt;
        }
      }

      if (nextScheduledAt === null) {
        return null;
      }
      return Math.max(0, nextScheduledAt - now);
    },

    acquireJob: async ({ typeNames }) => {
      const now = new Date();
      const eligibleJobs = Array.from(store.jobs.values())
        .filter(
          (job) =>
            typeNames.includes(job.typeName) && job.status === "pending" && job.scheduledAt <= now,
        )
        .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

      const candidateJob = eligibleJobs[0];
      if (!candidateJob) {
        return { job: undefined, hasMore: false };
      }

      const updatedJob: StateJob = {
        ...candidateJob,
        status: "running",
        attempt: candidateJob.attempt + 1,
      };
      store.jobs.set(candidateJob.id, updatedJob);

      return { job: updatedJob, hasMore: eligibleJobs.length > 1 };
    },

    renewJobLease: async ({ jobId, workerId, leaseDurationMs }) => {
      const job = store.jobs.get(jobId);
      if (!job) throw new Error("Job not found");

      const now = new Date();
      const updatedJob: StateJob = {
        ...job,
        leasedBy: workerId,
        leasedUntil: new Date(now.getTime() + leaseDurationMs),
        status: "running",
      };

      store.jobs.set(jobId, updatedJob);
      return updatedJob;
    },

    rescheduleJob: async ({ jobId, schedule, error }) => {
      const job = store.jobs.get(jobId);
      if (!job) throw new Error("Job not found");

      const now = new Date();
      const resolvedScheduledAt =
        schedule.at ?? (schedule.afterMs ? new Date(now.getTime() + schedule.afterMs) : now);
      const updatedJob: StateJob = {
        ...job,
        scheduledAt: resolvedScheduledAt,
        lastAttemptAt: now,
        lastAttemptError: error,
        leasedBy: null,
        leasedUntil: null,
        status: "pending",
      };

      store.jobs.set(jobId, updatedJob);
      return updatedJob;
    },

    completeJob: async ({ jobId, output, workerId }) => {
      const job = store.jobs.get(jobId);
      if (!job) throw new Error("Job not found");

      const now = new Date();
      const updatedJob: StateJob = {
        ...job,
        status: "completed",
        completedAt: now,
        completedBy: workerId,
        output,
        leasedBy: null,
        leasedUntil: null,
      };

      store.jobs.set(jobId, updatedJob);
      return updatedJob;
    },

    removeExpiredJobLease: async ({ typeNames, ignoredJobIds }) => {
      const now = new Date();
      let candidateJob: StateJob | undefined;
      const ignoredSet = ignoredJobIds ? new Set(ignoredJobIds) : undefined;

      for (const job of store.jobs.values()) {
        if (!typeNames.includes(job.typeName)) continue;
        if (job.status !== "running") continue;
        if (!job.leasedUntil || job.leasedUntil > now) continue;
        if (ignoredSet?.has(job.id)) continue;

        if (!candidateJob || job.leasedUntil < candidateJob.leasedUntil!) {
          candidateJob = job;
        }
      }

      if (!candidateJob) {
        return undefined;
      }

      const updatedJob: StateJob = {
        ...candidateJob,
        leasedBy: null,
        leasedUntil: null,
        status: "pending",
      };
      store.jobs.set(candidateJob.id, updatedJob);

      return updatedJob;
    },

    getExternalBlockers: async ({ rootChainIds }) => {
      const result: { jobId: string; blockedRootChainId: string }[] = [];
      const rootChainIdSet = new Set(rootChainIds);

      const chainIdsInRoots = new Set<string>();
      for (const job of store.jobs.values()) {
        if (rootChainIdSet.has(job.rootChainId)) {
          chainIdsInRoots.add(job.chainId);
        }
      }

      for (const [jobId, blockerMap] of store.jobBlockers) {
        const job = store.jobs.get(jobId);
        if (!job) continue;
        if (rootChainIdSet.has(job.rootChainId)) continue;

        for (const blockerChainId of blockerMap.keys()) {
          if (chainIdsInRoots.has(blockerChainId)) {
            result.push({ jobId, blockedRootChainId: job.rootChainId });
            break;
          }
        }
      }

      return result;
    },

    deleteJobsByRootChainIds: async ({ rootChainIds }) => {
      const deletedJobs: StateJob[] = [];
      const rootChainIdSet = new Set(rootChainIds);

      for (const [jobId, job] of store.jobs) {
        if (rootChainIdSet.has(job.rootChainId)) {
          deletedJobs.push(job);
          store.jobs.delete(jobId);
          store.jobBlockers.delete(jobId);
        }
      }

      for (const blockerMap of store.jobBlockers.values()) {
        for (const blockerChainId of blockerMap.keys()) {
          if (!store.jobs.has(blockerChainId)) {
            blockerMap.delete(blockerChainId);
          }
        }
      }

      return deletedJobs;
    },

    getJobForUpdate: async ({ jobId }) => {
      return store.jobs.get(jobId);
    },

    getCurrentJobForUpdate: async ({ chainId }) => {
      return getLastJobInChain(chainId);
    },

    listChains: async ({ filter, page }) => {
      // Pre-compute chain ID lookup for id filter (find chain containing a job with that ID)
      let idMatchChainIds: Set<string> | undefined;
      if (filter?.id) {
        idMatchChainIds = new Set<string>();
        for (const j of store.jobs.values()) {
          if (j.chainId === filter.id || j.id === filter.id) {
            idMatchChainIds.add(j.chainId);
          }
        }
      }

      const chains: [StateJob, StateJob | undefined][] = [];
      for (const job of store.jobs.values()) {
        if (job.id !== job.chainId) continue;

        const lastJob = getLastJobInChain(job.id);

        if (idMatchChainIds && !idMatchChainIds.has(job.chainId)) continue;
        if (filter?.rootOnly && job.rootChainId !== job.chainId) continue;
        if (!matchesTypeNameFilter(job, filter?.typeName)) continue;

        chains.push([job, lastJob?.id !== job.id ? lastJob : undefined]);
      }

      const sorted = chains.sort((a, b) => {
        const d = b[0].createdAt.getTime() - a[0].createdAt.getTime();
        if (d !== 0) return d;
        return b[0].id < a[0].id ? -1 : b[0].id > a[0].id ? 1 : 0;
      });

      let startIndex = 0;
      if (page.cursor) {
        const cursor = decodeCursor(page.cursor);
        startIndex = sorted.findIndex((item) => {
          const sv = item[0].createdAt.toISOString();
          return sv < cursor.createdAt || (sv === cursor.createdAt && item[0].id < cursor.id);
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
                id: lastItem[0].id,
                createdAt: lastItem[0].createdAt.toISOString(),
              })
            : null,
      };
    },

    listJobs: async ({ filter, page }) => {
      const jobs: StateJob[] = [];
      for (const job of store.jobs.values()) {
        if (filter?.id && job.id !== filter.id && job.chainId !== filter.id) continue;
        if (!matchesStatusFilter(job, filter?.status)) continue;
        if (!matchesTypeNameFilter(job, filter?.typeName)) continue;
        if (filter?.chainId && job.chainId !== filter.chainId) continue;
        jobs.push(job);
      }

      return paginate(jobs, page);
    },

    getJobsBlockedByChain: async ({ chainId }) => {
      const result: StateJob[] = [];
      for (const [jobId, blockerMap] of store.jobBlockers) {
        if (!blockerMap.has(chainId)) continue;
        const job = store.jobs.get(jobId);
        if (job) result.push(job);
      }
      return result;
    },
  };
};
