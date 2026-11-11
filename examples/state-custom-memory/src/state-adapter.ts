import {
  type OrderDirection,
  type Page,
  type ScheduleOptions,
  type StateAdapterConfig,
  type StateBlockedJob,
  type StateChain,
  type StateChainInfo,
  type StateCount,
  type StateJob,
  type StateJobBlockerInfo,
  type StateJobInfo,
  type StateAdapter,
  type StateWorkerInfo,
  type TxHooks,
  withTxHooks,
} from "queuert";

type MemoryWorker = Omit<StateWorkerInfo, "expired">;

type MemoryState = {
  chains: Map<string, StateChainInfo>;
  jobs: Map<string, StateJobInfo>;
  blockers: StateJobBlockerInfo[];
  workers: Map<string, MemoryWorker>;
};

export type MemoryTxContext = {
  transaction: { state: MemoryState | undefined } | undefined;
  txHooks: TxHooks;
};

export type MemoryStateAdapter = StateAdapter<MemoryTxContext, string, string>;

const emptyState = (): MemoryState => ({
  chains: new Map(),
  jobs: new Map(),
  blockers: [],
  workers: new Map(),
});

const resolveScheduledAt = (schedule: ScheduleOptions | undefined, now: Date): Date => {
  const requested = schedule?.at ?? new Date(now.getTime() + (schedule?.afterMs ?? 0));
  return requested > now ? requested : now;
};

const newJob = (
  job: {
    id: string;
    typeName: string;
    chainId: string;
    chainIndex: number;
    input: unknown;
    schedule?: ScheduleOptions;
    traceContext?: string | null;
  },
  now: Date,
): StateJobInfo => ({
  id: job.id,
  typeName: job.typeName,
  chainId: job.chainId,
  chainIndex: job.chainIndex,
  status: "pending",
  createdAt: now,
  input: job.input ?? null,
  scheduledAt: resolveScheduledAt(job.schedule, now),
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
  traceContext: job.traceContext ?? null,
});

const clearAttempt = (job: StateJobInfo): void => {
  job.attemptAt = null;
  job.attemptBy = null;
  job.attemptToken = null;
};

const holdsAttempt = (job: StateJobInfo, attemptToken: string | undefined): boolean =>
  job.status !== "completed" &&
  (attemptToken === undefined || (job.status === "running" && job.attemptToken === attemptToken));

const isLive = (worker: MemoryWorker, now: Date): boolean => worker.leaseUntil > now;

const toWorker = (worker: MemoryWorker, now: Date): StateWorkerInfo => ({
  ...worker,
  expired: !isLive(worker, now),
});

const toJob = (state: MemoryState, job: StateJobInfo): StateJob => ({
  ...job,
  chain: state.chains.get(job.chainId)!,
});

const toChain = (state: MemoryState, chain: StateChainInfo): StateChain => {
  const continuations = [...state.jobs.values()]
    .filter((job) => job.chainId === chain.id && job.chainIndex > 0)
    .toSorted((a, b) => b.chainIndex - a.chainIndex);
  return { ...chain, head: state.jobs.get(chain.id)!, tail: continuations[0] };
};

const blockersOf = (state: MemoryState, jobId: string): StateJobBlockerInfo[] =>
  state.blockers.filter((blocker) => blocker.jobId === jobId).toSorted((a, b) => a.index - b.index);

const dependentsOf = (state: MemoryState, chainId: string): StateJobBlockerInfo[] =>
  state.blockers.filter((blocker) => blocker.blockedByChainId === chainId);

const findDeduplicatedChain = (
  state: MemoryState,
  typeName: string,
  { key, scope }: { key: string; scope: "running" | "any" },
): StateChainInfo | undefined =>
  [...state.chains.values()]
    .filter(
      (chain) =>
        chain.typeName === typeName &&
        chain.deduplicationKey === key &&
        (scope === "any" || chain.status === "running"),
    )
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

const countUpTo = (count: number, countCap: number): StateCount => ({
  count: Math.min(count, countCap),
  hasMore: count > countCap,
});

const inRange = (value: Date | null, from?: Date, to?: Date): boolean =>
  value !== null && (!from || value >= from) && (!to || value <= to);

type SortKey = [number, string];

const compareSortKeys = (a: SortKey, b: SortKey, orderDirection: OrderDirection): number => {
  const order = a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  return orderDirection === "asc" ? order : -order;
};

const encodeCursor = (key: SortKey): string =>
  Buffer.from(JSON.stringify(key)).toString("base64url");

const decodeCursor = (cursor: string): SortKey =>
  JSON.parse(Buffer.from(cursor, "base64url").toString()) as SortKey;

const paginate = <T extends { id: string }>(
  items: T[],
  sortValue: (item: T) => number,
  orderDirection: OrderDirection,
  page: { cursor?: string; limit: number },
): Page<T> => {
  const sortKey = (item: T): SortKey => [sortValue(item), item.id];
  const after = page.cursor === undefined ? undefined : decodeCursor(page.cursor);
  const remaining = items
    .filter((item) => !after || compareSortKeys(sortKey(item), after, orderDirection) > 0)
    .toSorted((a, b) => compareSortKeys(sortKey(a), sortKey(b), orderDirection));
  const pageItems = remaining.slice(0, page.limit);
  const last = pageItems.at(-1);
  return {
    items: pageItems,
    nextCursor: remaining.length > page.limit && last ? encodeCursor(sortKey(last)) : null,
  };
};

export const createMemoryStateAdapter = (
  options: Partial<StateAdapterConfig<string, string>> = {},
): MemoryStateAdapter => {
  const config: StateAdapterConfig<string, string> = {
    generateJobId: () => crypto.randomUUID(),
    validateJobId: () => true,
    generateWorkerId: () => crypto.randomUUID(),
    validateWorkerId: () => true,
    maxBlockersPerJob: 100,
    countCap: 10_000,
    ...options,
  };
  let committed = emptyState();

  // Transactions run one at a time: each starts from the committed state and replaces it on commit
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = async <T>(fn: () => Promise<T>): Promise<T> => {
    const turn = queue.then(fn);
    queue = turn.catch(() => undefined);
    return turn;
  };

  const withTransaction = async <T>(fn: (txCtx: MemoryTxContext) => Promise<T>): Promise<T> =>
    withTxHooks(async (txHooks) =>
      serialized(async () => {
        const transaction: { state: MemoryState | undefined } = { state: committed };
        try {
          const result = await fn({ transaction, txHooks });
          committed = transaction.state!;
          return result;
        } finally {
          transaction.state = undefined;
        }
      }),
    );

  const read = async <T>(
    txCtx: MemoryTxContext | undefined,
    query: (state: MemoryState) => T,
  ): Promise<T> => structuredClone(query(txCtx?.transaction?.state ?? committed));

  // A write without a transaction context runs in a transaction of its own. Every write changes a
  // copy, so a batch that throws midway leaves nothing behind even if the caller goes on to commit
  const write = async <T>(
    txCtx: MemoryTxContext | undefined,
    change: (state: MemoryState) => T,
  ): Promise<T> => {
    const transaction = txCtx?.transaction;
    if (!transaction?.state) return withTransaction(async (txCtx) => write(txCtx, change));
    const draft = structuredClone(transaction.state);
    const result = change(draft);
    transaction.state = draft;
    return structuredClone(result);
  };

  const close = async (): Promise<void> => {};

  return {
    config,

    withTransaction,

    isTransaction: (txCtx) => txCtx.transaction?.state !== undefined,
    onTransactionCommit: (txCtx, callback) => {
      txCtx.txHooks.onCommit(callback);
    },
    onTransactionRollback: (txCtx, callback) => {
      txCtx.txHooks.onRollback(callback);
    },

    getChains: async ({ txCtx, chainIds }) =>
      read(txCtx, (state) =>
        chainIds.map((chainId) => {
          const chain = state.chains.get(chainId);
          return chain && toChain(state, chain);
        }),
      ),

    getJobs: async ({ txCtx, jobIds }) =>
      read(txCtx, (state) =>
        jobIds.map((jobId) => {
          const job = state.jobs.get(jobId);
          return job && toJob(state, job);
        }),
      ),

    getWorkers: async ({ txCtx, workerIds }) =>
      read(txCtx, (state) =>
        workerIds.map((workerId) => {
          const worker = state.workers.get(workerId);
          return worker && toWorker(worker, new Date());
        }),
      ),

    createJobs: async ({ txCtx, jobs }) =>
      write(txCtx, (state) => {
        const now = new Date();
        return jobs.map((job) => {
          const existing = job.deduplication
            ? findDeduplicatedChain(state, job.typeName, job.deduplication)
            : undefined;
          if (existing) return { ...toChain(state, existing), deduplicated: true };

          if (state.jobs.has(job.id)) throw new Error(`Job ${job.id} already exists`);
          const chain: StateChainInfo = {
            id: job.id,
            typeName: job.typeName,
            status: "running",
            deduplicationKey: job.deduplication?.key ?? null,
            createdAt: now,
            completedAt: null,
            traceContext: job.chainTraceContext ?? null,
          };
          state.chains.set(chain.id, chain);
          state.jobs.set(job.id, newJob({ ...job, chainId: job.id, chainIndex: 0 }, now));
          return { ...toChain(state, chain), deduplicated: false };
        });
      }),

    continueJobs: async ({ txCtx, jobs }) =>
      write(txCtx, (state) => {
        const now = new Date();
        const parents = jobs.map((job) => {
          const parent = state.jobs.get(job.continueFromId);
          return parent && holdsAttempt(parent, job.attemptToken) ? parent : undefined;
        });
        return jobs.map((job, index) => {
          const parent = parents[index];
          if (!parent) return undefined;

          const chainIndex = parent.chainIndex + 1;
          const taken = [...state.jobs.values()].some(
            (other) => other.chainId === parent.chainId && other.chainIndex === chainIndex,
          );
          if (taken) throw new Error(`Chain ${parent.chainId} already has a job at ${chainIndex}`);
          if (state.jobs.has(job.id)) throw new Error(`Job ${job.id} already exists`);

          const continuation = newJob({ ...job, chainId: parent.chainId, chainIndex }, now);
          state.jobs.set(continuation.id, continuation);

          parent.status = "completed";
          parent.completedAt = now;
          parent.completedBy = job.workerId ?? null;
          parent.continuedToId = continuation.id;
          parent.output = null;
          parent.lastAttemptError = null;
          clearAttempt(parent);
          return { ...toJob(state, parent), continuation };
        });
      }),

    completeJobs: async ({ txCtx, jobs }) =>
      write(txCtx, (state) => {
        const now = new Date();
        return jobs.map(({ jobId, output, attemptToken, workerId }) => {
          const job = state.jobs.get(jobId);
          if (!job || !holdsAttempt(job, attemptToken)) return undefined;

          job.status = "completed";
          job.completedAt = now;
          job.completedBy = workerId ?? null;
          job.output = output ?? null;
          job.lastAttemptError = null;
          clearAttempt(job);

          const chain = state.chains.get(job.chainId)!;
          chain.status = "completed";
          chain.completedAt ??= now;
          return toJob(state, job);
        });
      }),

    rescheduleJobs: async ({ txCtx, jobs }) =>
      write(txCtx, (state) => {
        const now = new Date();
        return jobs.map(({ jobId, schedule, error, attemptToken }) => {
          const job = state.jobs.get(jobId);
          if (!job || !holdsAttempt(job, attemptToken)) return undefined;

          if (job.status === "running") {
            job.status = "pending";
            job.lastAttemptAt = now;
            job.lastAttemptError = error ?? null;
          }
          job.scheduledAt = resolveScheduledAt(schedule, now);
          clearAttempt(job);
          return toJob(state, job);
        });
      }),

    deleteChains: async ({ txCtx, chainIds }) =>
      write(txCtx, (state) => {
        const outsideBlockers = state.blockers.filter(
          (blocker) =>
            chainIds.includes(blocker.blockedByChainId) &&
            !chainIds.includes(state.jobs.get(blocker.jobId)!.chainId),
        );
        if (outsideBlockers.length > 0) {
          return chainIds.map((chainId) => {
            const blockedJobs = outsideBlockers
              .filter((blocker) => blocker.blockedByChainId === chainId)
              .map((blocker): StateBlockedJob => ({
                ...blocker,
                job: state.jobs.get(blocker.jobId)!,
              }));
            return blockedJobs.length > 0 ? blockedJobs : undefined;
          });
        }

        const deleted = chainIds.map((chainId) => {
          const chain = state.chains.get(chainId);
          return chain && toChain(state, chain);
        });
        for (const job of state.jobs.values()) {
          if (chainIds.includes(job.chainId)) {
            state.jobs.delete(job.id);
          }
        }
        for (const chainId of chainIds) state.chains.delete(chainId);
        state.blockers = state.blockers.filter((blocker) => state.jobs.has(blocker.jobId));
        return deleted;
      }),

    startJobAttempts: async ({ txCtx, typeNames, workerId, workerToken, limit }) =>
      write(txCtx, (state) => {
        const now = new Date();
        const worker = state.workers.get(workerId);
        if (!worker || worker.token !== workerToken || !isLive(worker, now)) return [];

        const due = [...state.jobs.values()]
          .filter(
            (job) =>
              job.status === "pending" &&
              typeNames.includes(job.typeName) &&
              job.scheduledAt <= now,
          )
          .toSorted((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
          .slice(0, limit);
        return due.map((job) => {
          job.status = "running";
          job.attempt += 1;
          job.attemptAt = now;
          job.attemptBy = workerId;
          job.attemptToken = crypto.randomUUID();
          return { ...toJob(state, job), hasBlockers: blockersOf(state, job.id).length > 0 };
        });
      }),

    getStartAttemptDelayMs: async ({ txCtx, typeNames }) =>
      read(txCtx, (state) => {
        const scheduledAts = [...state.jobs.values()]
          .filter((job) => job.status === "pending" && typeNames.includes(job.typeName))
          .map((job) => job.scheduledAt.getTime());
        if (scheduledAts.length === 0) return null;
        return Math.max(0, Math.min(...scheduledAts) - Date.now());
      }),

    addJobsBlockers: async ({ txCtx, jobBlockers }) =>
      write(txCtx, (state) =>
        jobBlockers.map(({ jobId, blockedByChainIds, blockerTraceContexts }) => {
          const job = state.jobs.get(jobId);
          if (!job) throw new Error(`Job ${jobId} not found`);

          const blockers = blockedByChainIds.map((blockedByChainId, index) => {
            const chain = state.chains.get(blockedByChainId);
            if (chain) {
              const traceContext = blockerTraceContexts?.[index] ?? null;
              state.blockers.push({ jobId, blockedByChainId, index, traceContext });
            }
            return chain;
          });
          if (job.status === "pending" && blockers.some((chain) => chain?.status === "running")) {
            job.status = "blocked";
          }
          return { ...toJob(state, job), blockers };
        }),
      ),

    getJobBlockers: async ({ txCtx, jobId }) =>
      read(txCtx, (state) =>
        blockersOf(state, jobId).map((blocker) =>
          toChain(state, state.chains.get(blocker.blockedByChainId)!),
        ),
      ),

    unblockJobs: async ({ txCtx, blockedByChainId }) =>
      write(txCtx, (state) => {
        const now = new Date();
        const dependents = dependentsOf(state, blockedByChainId).toSorted((a, b) =>
          a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : a.index - b.index,
        );
        for (const { jobId } of dependents) {
          const job = state.jobs.get(jobId)!;
          const allBlockersCompleted = blockersOf(state, jobId).every(
            (blocker) => state.chains.get(blocker.blockedByChainId)?.status === "completed",
          );
          if (job.status === "blocked" && allBlockersCompleted) {
            job.status = "pending";
            job.scheduledAt = job.scheduledAt > now ? job.scheduledAt : now;
          }
        }
        return dependents.map((blocker) => ({
          ...blocker,
          job: toJob(state, state.jobs.get(blocker.jobId)!),
        }));
      }),

    startWorker: async ({ txCtx, workerId, typeNames, concurrency, leaseMs }) =>
      write(txCtx, (state) => {
        if (state.workers.has(workerId)) throw new Error(`Worker ${workerId} already exists`);
        const now = new Date();
        const worker: MemoryWorker = {
          id: workerId,
          typeNames,
          concurrency,
          startedAt: now,
          leaseUntil: new Date(now.getTime() + leaseMs),
          token: crypto.randomUUID(),
        };
        state.workers.set(workerId, worker);
        return toWorker(worker, now);
      }),

    extendWorkerLease: async ({ txCtx, workerId, workerToken, leaseMs }) =>
      write(txCtx, (state) => {
        const now = new Date();
        const worker = state.workers.get(workerId);
        if (!worker || worker.token !== workerToken || !isLive(worker, now)) return undefined;
        worker.leaseUntil = new Date(now.getTime() + leaseMs);
        return toWorker(worker, now);
      }),

    stopWorker: async ({ txCtx, workerId, workerToken }) =>
      write(txCtx, (state) => {
        const worker = state.workers.get(workerId);
        if (!worker || worker.token !== workerToken) return undefined;
        state.workers.delete(workerId);
        return toWorker(worker, new Date());
      }),

    getChainTypeNames: async ({ txCtx }) =>
      read(txCtx, (state) =>
        [...new Set([...state.chains.values()].map((chain) => chain.typeName))].toSorted(),
      ),

    getJobTypeNames: async ({ txCtx }) =>
      read(txCtx, (state) =>
        [...new Set([...state.jobs.values()].map((job) => job.typeName))].toSorted(),
      ),

    countChainsByTypeName: async ({ txCtx, typeNames }) =>
      read(txCtx, (state) =>
        typeNames.map((typeName) => {
          const chains = [...state.chains.values()].filter((chain) => chain.typeName === typeName);
          const count = (status: string) =>
            countUpTo(chains.filter((chain) => chain.status === status).length, config.countCap);
          return { running: count("running"), completed: count("completed") };
        }),
      ),

    countJobsByTypeName: async ({ txCtx, typeNames }) =>
      read(txCtx, (state) =>
        typeNames.map((typeName) => {
          const jobs = [...state.jobs.values()].filter((job) => job.typeName === typeName);
          const count = (status: string) =>
            countUpTo(jobs.filter((job) => job.status === status).length, config.countCap);
          return {
            blocked: count("blocked"),
            pending: count("pending"),
            running: count("running"),
            completed: count("completed"),
          };
        }),
      ),

    countWorkers: async ({ txCtx }) =>
      read(txCtx, (state) => {
        const now = new Date();
        const workers = [...state.workers.values()];
        const live = workers.filter((worker) => isLive(worker, now)).length;
        return { live, expired: workers.length - live };
      }),

    countWorkersByTypeName: async ({ txCtx, typeNames }) =>
      read(txCtx, (state) => {
        const now = new Date();
        return typeNames.map((typeName) => {
          const workers = [...state.workers.values()].filter((worker) =>
            worker.typeNames.includes(typeName),
          );
          const live = workers.filter((worker) => isLive(worker, now)).length;
          return { live, expired: workers.length - live };
        });
      }),

    countRunningJobsByWorkerId: async ({ txCtx, workerIds }) =>
      read(txCtx, (state) =>
        workerIds.map(
          (workerId) =>
            [...state.jobs.values()].filter(
              (job) => job.status === "running" && job.attemptBy === workerId,
            ).length,
        ),
      ),

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
      read(txCtx, (state) => {
        const sortDate = (chain: StateChainInfo) =>
          orderBy === "completedAt" ? chain.completedAt : chain.createdAt;
        const chains = [...state.chains.values()]
          .filter(
            (chain) =>
              chain.typeName === typeName &&
              (status === undefined || chain.status === status) &&
              (independent === undefined ||
                independent === (dependentsOf(state, chain.id).length === 0)) &&
              inRange(sortDate(chain), from, to),
          )
          .map((chain) => toChain(state, chain));
        return paginate(chains, (chain) => sortDate(chain)!.getTime(), orderDirection, page);
      }),

    listJobs: async ({ txCtx, typeName, from, to, status, orderBy, orderDirection, page }) =>
      read(txCtx, (state) => {
        const jobs = [...state.jobs.values()]
          .filter(
            (job) =>
              job.typeName === typeName &&
              (status === undefined || job.status === status) &&
              inRange(job[orderBy], from, to),
          )
          .map((job) => toJob(state, job));
        return paginate(jobs, (job) => job[orderBy]!.getTime(), orderDirection, page);
      }),

    listChainJobs: async ({ txCtx, chainId, orderDirection, page }) =>
      read(txCtx, (state) => {
        const jobs = [...state.jobs.values()]
          .filter((job) => job.chainId === chainId)
          .map((job) => toJob(state, job));
        return paginate(jobs, (job) => job.chainIndex, orderDirection, page);
      }),

    listBlockedJobs: async ({ txCtx, chainId, orderDirection, page }) =>
      read(txCtx, (state) => {
        const blockedJobIds = new Set(dependentsOf(state, chainId).map((blocker) => blocker.jobId));
        const jobs = [...blockedJobIds].map((jobId) => toJob(state, state.jobs.get(jobId)!));
        return paginate(jobs, (job) => job.createdAt.getTime(), orderDirection, page);
      }),

    listWorkers: async ({ txCtx, typeName, status, orderDirection, page }) =>
      read(txCtx, (state) => {
        const now = new Date();
        const workers = [...state.workers.values()]
          .filter(
            (worker) =>
              (typeName === undefined || worker.typeNames.includes(typeName)) &&
              (status === undefined || isLive(worker, now) === (status === "live")),
          )
          .map((worker) => toWorker(worker, now));
        return paginate(workers, (worker) => worker.startedAt.getTime(), orderDirection, page);
      }),

    listWorkerJobs: async ({ txCtx, workerId, orderDirection, page }) =>
      read(txCtx, (state) => {
        const jobs = [...state.jobs.values()]
          .filter((job) => job.status === "running" && job.attemptBy === workerId)
          .map((job) => toJob(state, job));
        return paginate(jobs, (job) => job.attemptAt!.getTime(), orderDirection, page);
      }),

    close,

    [Symbol.asyncDispose]: close,
  };
};
