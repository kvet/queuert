import { DeduplicationOptions, StateAdapter, StateJob } from "./state-adapter.js";

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

  const lockQueue: (() => void)[] = [];
  let isLocked = false;

  const acquireLock = async (): Promise<void> => {
    if (!isLocked) {
      isLocked = true;
      return;
    }
    await new Promise<void>((resolve) => {
      lockQueue.push(resolve);
    });
  };

  const releaseLock = (): void => {
    const next = lockQueue.shift();
    if (next) {
      next();
    } else {
      isLocked = false;
    }
  };

  const getLastJobInSequence = (sequenceId: string): StateJob | undefined => {
    let lastJob: StateJob | undefined;
    for (const job of store.jobs.values()) {
      if (job.sequenceId === sequenceId) {
        if (!lastJob || job.createdAt >= lastJob.createdAt) {
          lastJob = job;
        }
      }
    }
    return lastJob;
  };

  const findExistingContinuation = (
    sequenceId: string | undefined,
    originId: string | undefined,
  ): StateJob | undefined => {
    if (!sequenceId || !originId) return undefined;
    for (const job of store.jobs.values()) {
      if (job.sequenceId === sequenceId && job.originId === originId) {
        return job;
      }
    }
    return undefined;
  };

  const findDeduplicatedJob = (deduplication: DeduplicationOptions): StateJob | undefined => {
    if (!deduplication.key) return undefined;

    let bestMatch: StateJob | undefined;
    const now = Date.now();
    const strategy = deduplication.strategy ?? "completed";

    for (const job of store.jobs.values()) {
      if (job.deduplicationKey !== deduplication.key) continue;
      if (job.id !== job.sequenceId) continue; // Only root jobs

      if (strategy === "completed" && job.status === "completed") continue;

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
    provideContext: async (fn) => {
      return fn({});
    },

    runInTransaction: async (context, fn) => {
      if (context.inTransaction) {
        return fn(context);
      }

      await acquireLock();

      const snapshot = deepCloneStore(store);
      const txContext: InProcessContext = { inTransaction: true };

      try {
        return await fn(txContext);
      } catch (error) {
        store.jobs = snapshot.jobs;
        store.jobBlockers = snapshot.jobBlockers;
        throw error;
      } finally {
        releaseLock();
      }
    },

    assertInTransaction: async (context) => {
      if (!context.inTransaction) {
        throw new Error("Not in transaction");
      }
    },

    getJobSequenceById: async ({ jobId }) => {
      const rootJob = store.jobs.get(jobId);
      if (!rootJob) return undefined;

      const lastJob = getLastJobInSequence(jobId);
      return [rootJob, lastJob?.id !== rootJob.id ? lastJob : undefined];
    },

    getJobById: async ({ jobId }) => {
      return store.jobs.get(jobId);
    },

    createJob: async ({
      typeName,
      input,
      rootId,
      sequenceId,
      originId,
      deduplication,
      schedule,
    }) => {
      const existingContinuation = findExistingContinuation(sequenceId, originId);
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
        input,
        output: null,
        rootId: rootId ?? id,
        sequenceId: sequenceId ?? id,
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
        updatedAt: now,
      };

      store.jobs.set(id, job);
      return { job, deduplicated: false };
    },

    addJobBlockers: async ({ jobId, blockedBySequenceIds }) => {
      const job = store.jobs.get(jobId);
      if (!job) throw new Error("Job not found");

      const blockerMap = store.jobBlockers.get(jobId) ?? new Map<string, number>();
      blockedBySequenceIds.forEach((seqId, index) => {
        blockerMap.set(seqId, index);
      });
      store.jobBlockers.set(jobId, blockerMap);

      let hasIncompleteBlocker = false;
      for (const seqId of blockedBySequenceIds) {
        const lastJob = getLastJobInSequence(seqId);
        if (!lastJob || lastJob.status !== "completed") {
          hasIncompleteBlocker = true;
          break;
        }
      }

      if (hasIncompleteBlocker && job.status === "pending") {
        const updatedJob: StateJob = { ...job, status: "blocked", updatedAt: new Date() };
        store.jobs.set(jobId, updatedJob);
        return updatedJob;
      }

      return job;
    },

    scheduleBlockedJobs: async ({ blockedBySequenceId }) => {
      const scheduledJobs: StateJob[] = [];
      const now = new Date();

      for (const [jobId, blockerMap] of store.jobBlockers) {
        if (!blockerMap.has(blockedBySequenceId)) continue;

        const job = store.jobs.get(jobId);
        if (!job || job.status !== "blocked") continue;

        let allComplete = true;
        for (const seqId of blockerMap.keys()) {
          const lastJob = getLastJobInSequence(seqId);
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
            updatedAt: now,
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
      for (const [seqId] of entries) {
        const rootJob = store.jobs.get(seqId);
        if (!rootJob) continue;

        const lastJob = getLastJobInSequence(seqId);
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
      let candidateJob: StateJob | undefined;

      for (const job of store.jobs.values()) {
        if (!typeNames.includes(job.typeName)) continue;
        if (job.status !== "pending") continue;
        if (job.scheduledAt > now) continue;

        if (!candidateJob || job.scheduledAt < candidateJob.scheduledAt) {
          candidateJob = job;
        }
      }

      if (!candidateJob) {
        return undefined;
      }

      const updatedJob: StateJob = {
        ...candidateJob,
        status: "running",
        attempt: candidateJob.attempt + 1,
        updatedAt: now,
      };
      store.jobs.set(candidateJob.id, updatedJob);

      return updatedJob;
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
        updatedAt: now,
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
        updatedAt: now,
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
        updatedAt: now,
      };

      store.jobs.set(jobId, updatedJob);
      return updatedJob;
    },

    removeExpiredJobLease: async ({ typeNames }) => {
      const now = new Date();
      let candidateJob: StateJob | undefined;

      for (const job of store.jobs.values()) {
        if (!typeNames.includes(job.typeName)) continue;
        if (job.status !== "running") continue;
        if (!job.leasedUntil || job.leasedUntil > now) continue;

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
        updatedAt: now,
      };
      store.jobs.set(candidateJob.id, updatedJob);

      return updatedJob;
    },

    getExternalBlockers: async ({ rootIds }) => {
      const result: { jobId: string; blockedRootId: string }[] = [];
      const rootIdSet = new Set(rootIds);

      const sequenceIdsInRoots = new Set<string>();
      for (const job of store.jobs.values()) {
        if (rootIdSet.has(job.rootId)) {
          sequenceIdsInRoots.add(job.sequenceId);
        }
      }

      for (const [jobId, blockerMap] of store.jobBlockers) {
        const job = store.jobs.get(jobId);
        if (!job) continue;
        if (rootIdSet.has(job.rootId)) continue;

        for (const seqId of blockerMap.keys()) {
          if (sequenceIdsInRoots.has(seqId)) {
            result.push({ jobId, blockedRootId: job.rootId });
            break;
          }
        }
      }

      return result;
    },

    deleteJobsByRootIds: async ({ rootIds }) => {
      const deletedJobs: StateJob[] = [];
      const rootIdSet = new Set(rootIds);

      for (const [jobId, job] of store.jobs) {
        if (rootIdSet.has(job.rootId)) {
          deletedJobs.push(job);
          store.jobs.delete(jobId);
          store.jobBlockers.delete(jobId);
        }
      }

      for (const blockerMap of store.jobBlockers.values()) {
        for (const seqId of blockerMap.keys()) {
          if (!store.jobs.has(seqId)) {
            blockerMap.delete(seqId);
          }
        }
      }

      return deletedJobs;
    },

    getJobForUpdate: async ({ jobId }) => {
      return store.jobs.get(jobId);
    },

    getCurrentJobForUpdate: async ({ sequenceId }) => {
      return getLastJobInSequence(sequenceId);
    },
  };
};
