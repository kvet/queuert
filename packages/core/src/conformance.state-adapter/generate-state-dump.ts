import type { InProcessContext } from "../state-adapter.in-process/in-process-state.ts";
import {
  createSortedList,
  deleteFromSortedList,
  firstOfSortedList,
  insertIntoSortedList,
} from "../state-adapter.in-process/sorted-list.ts";
import type {
  StateJob,
  StateJobInfo,
  StateJobStatus,
  StateWorkerInfo,
} from "../state-adapter/state-adapter.ts";
import type { StateDump } from "../state-adapter/state-dump.ts";
import { createSeedStateAdapter } from "./seed-state-adapter.ts";

export type SeedSentinels = {
  pending: {
    jobId: string;
    typeNames: string[];
  };
  scheduled: {
    jobId: string;
    typeName: string;
  };
  running: {
    jobId: string;
    typeNames: string[];
  };
  completed: {
    jobId: string;
    typeNames: string[];
  };
  retried: {
    jobId: string;
    typeName: string;
  };
  longChain: {
    chainId: string;
    length: number;
    headJobId: string;
    tailJobId: string;
  };
  fanIn: {
    blockerChainIds: string[];
    blockedCount: number;
    blockersPerJob: number;
    blockedJobId: string;
  };
  fanOut: {
    blockerChainId: string;
    blockedJobIds: string[];
    blockedCount: number;
  };
  blocking: {
    chainId: string;
    count: number;
  };
  workers: {
    idleWorkerIds: string[];
    busyWorkerId: string;
  };
  throwaway: {
    pendingTypeName: string;
    runningTypeName: string;
    expiredRunningTypeName: string;
    chainIds: string[];
    unblockerChainIds: string[];
  };
};

export const seedConfig = {
  randomSeed: 20260101,
  startMs: 1767225600000, // Date.UTC(2026, 0, 1)
  windowMs: 604800000, // 7 * 24 * 60 * 60 * 1000
  recentMs: 3600000, // 60 * 60 * 1000
  createBatch: 50,
  attemptLatencyMs: 30000,
  attemptDurationMs: 20000,
  workerId: "00000000-0000-4000-8000-000000000000",
  workerTypeNames: [
    "seed:running:order",
    "seed:running:payment",
    "seed:completed:order",
    "seed:completed:payment",
    "seed:retried",
    "seed:chain",
    "seed:throwaway:running",
  ],
  busyWorkerId: "00000000-0000-4000-8000-000000000002",
  busyWorkerTypeNames: ["seed:busy"],
  idleWorkers: [
    { id: "00000000-0000-4000-8000-000000000003", typeNames: ["seed:pending:order"] },
    { id: "00000000-0000-4000-8000-000000000004", typeNames: ["seed:pending:payment"] },
    { id: "00000000-0000-4000-8000-000000000005", typeNames: ["seed:pending:notify"] },
  ],
  expiredWorkerId: "00000000-0000-4000-8000-000000000006",
  expiredWorkerTypeNames: ["seed:throwaway:expired"],
  workerConcurrency: 10,
  leaseMs: 3600000, // 60 * 60 * 1000
  futureMs: 86400000, // 24 * 60 * 60 * 1000
  pendingTypes: ["seed:pending:order", "seed:pending:payment", "seed:pending:notify"],
  runningTypes: ["seed:running:order", "seed:running:payment"],
  completedTypes: ["seed:completed:order", "seed:completed:payment"],
  pendingPerType: 1500,
  scheduledCount: 500,
  runningPerType: 250,
  completedPerType: 600,
  retriedCount: 500,
  chainLength: 20,
  fanInTiers: [
    { blocked: 1000, blockers: 1 },
    { blocked: 100, blockers: 10 },
    { blocked: 10, blockers: 100 },
  ],
  fanOutTiers: [
    { blockers: 1, blockedPer: 1000 },
    { blockers: 10, blockedPer: 100 },
    { blockers: 100, blockedPer: 10 },
  ],
  blocking: 200,
  throwawayPending: 50,
  throwawayRunning: 20,
  throwawayExpiredRunning: 20,
  throwawayChains: 20,
  throwawayUnblockers: 20,
  background: {
    chainsPerScale: 600,
    typeCount: 20,
    workerCount: 4,
    workerConcurrency: 50,
    continueProbability: 0.6,
    failureProbability: 0.1,
    maxChainLength: 50,
    deduplicationProbability: 0.15,
    deduplicationKeysPerType: 50,
    traceContextProbability: 0.3,
    blockerProbability: 0.1,
    maxBlockers: 3,
    scheduleProbability: 0.1,
    scheduleMeanMs: 600000, // 10 * 60 * 1000
    backlogProbability: 0.03,
    maxBackoffMs: 3600000, // 60 * 60 * 1000
    errors: [
      "Error: upstream request timed out",
      "Error: connection reset by peer",
      "Error: rate limit exceeded",
    ],
  },
} as const;

const chunkIndexes = (total: number, size: number): number[][] => {
  const chunks: number[][] = [];
  for (let start = 0; start < total; start += size) {
    chunks.push(Array.from({ length: Math.min(size, total - start) }, (_, i) => start + i));
  }
  return chunks;
};

const range = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const randomHex = (random: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(random() * 16).toString(16)).join("");

const randomUuid = (random: () => number): string => {
  const hex = randomHex(random, 32);
  const variant = (8 + Math.floor(random() * 4)).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20)}`;
};

type SeedEvent = { atMs: number; order: number; run: () => void };

const createEventQueue = (): {
  schedule: (atMs: number, run: () => void) => void;
  next: () => SeedEvent | undefined;
} => {
  const events = createSortedList<SeedEvent>((a, b) => a.atMs - b.atMs || a.order - b.order);
  let order = 0;
  return {
    schedule: (atMs, run) => {
      insertIntoSortedList(events, { atMs, order: order++, run });
    },
    next: () => {
      const event = firstOfSortedList(events);
      if (event !== undefined) deleteFromSortedList(events, event);
      return event;
    },
  };
};

export const generateStateDump = ({ scale = 1 }: { scale?: number } = {}): {
  dump: StateDump;
  sentinels: SeedSentinels;
} => {
  const { background } = seedConfig;
  const random = createRandom(seedConfig.randomSeed);
  const clock: { nowMs: number } = { nowMs: seedConfig.startMs };
  const { stateAdapter, dumpState } = createSeedStateAdapter({
    now: () => clock.nowMs,
    generateJobId: () => randomUuid(random),
  });
  const events = createEventQueue();
  const startMs = seedConfig.startMs;
  const endMs = startMs + seedConfig.windowMs;
  const recentMs = endMs - seedConfig.recentMs;
  const farFuture = { at: new Date(endMs + seedConfig.futureMs) };

  const randomTime = (fromMs: number, toMs: number): number =>
    fromMs + Math.floor(random() * (toMs - fromMs));
  const exponential = (meanMs: number): number => Math.round(-Math.log(1 - random()) * meanMs);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const traceContext = (): string => `00-${randomHex(random, 32)}-${randomHex(random, 16)}-01`;
  const transact = <T>(fn: (txCtx: InProcessContext) => T): T => stateAdapter.withTransaction(fn);

  const startWorker = (
    workerId: string,
    typeNames: readonly string[],
    {
      concurrency = seedConfig.workerConcurrency,
      leaseMs = seedConfig.windowMs + seedConfig.leaseMs,
    }: { concurrency?: number; leaseMs?: number } = {},
  ): StateWorkerInfo =>
    stateAdapter.startWorker({ workerId, typeNames: [...typeNames], concurrency, leaseMs });

  const createHeads = (
    txCtx: InProcessContext,
    typeName: string,
    indexes: number[],
    schedule?: { at: Date },
  ): StateJobInfo[] =>
    stateAdapter
      .createJobs({
        txCtx,
        jobs: indexes.map((index) => ({
          id: stateAdapter.config.generateJobId(),
          typeName,
          input: { index },
          ...(schedule === undefined ? {} : { schedule }),
        })),
      })
      .map((result) => result.head);

  const claim = (
    txCtx: InProcessContext,
    typeName: string,
    worker: StateWorkerInfo,
    limit: number,
  ): StateJob[] =>
    stateAdapter.startJobAttempts({
      txCtx,
      typeNames: [typeName],
      workerId: worker.id,
      workerToken: worker.token,
      limit,
    });

  const spreadBatches = (
    total: number,
    fromMs: number,
    toMs: number,
    run: (indexes: number[]) => void,
  ): void => {
    for (const indexes of chunkIndexes(total, seedConfig.createBatch)) {
      events.schedule(randomTime(fromMs, toMs), () => {
        run(indexes);
      });
    }
  };

  const createThenAttempt = (
    typeName: string,
    indexes: number[],
    worker: StateWorkerInfo,
    finish?: (txCtx: InProcessContext, job: StateJob) => void,
  ): void => {
    transact((txCtx) => createHeads(txCtx, typeName, indexes));
    events.schedule(Math.min(clock.nowMs + exponential(seedConfig.attemptLatencyMs), endMs), () => {
      const claimed = transact((txCtx) => claim(txCtx, typeName, worker, indexes.length));
      if (finish === undefined) return;
      events.schedule(
        Math.min(clock.nowMs + exponential(seedConfig.attemptDurationMs), endMs),
        () => {
          transact((txCtx) => {
            for (const job of claimed) finish(txCtx, job);
          });
        },
      );
    });
  };

  const seedWorker = startWorker(seedConfig.workerId, seedConfig.workerTypeNames);
  for (const idleWorker of seedConfig.idleWorkers) {
    startWorker(idleWorker.id, idleWorker.typeNames);
  }
  const busyWorker = startWorker(seedConfig.busyWorkerId, seedConfig.busyWorkerTypeNames);

  for (const typeName of seedConfig.pendingTypes) {
    spreadBatches(seedConfig.pendingPerType * scale, startMs, endMs, (indexes) => {
      transact((txCtx) => createHeads(txCtx, typeName, indexes));
    });
  }

  spreadBatches(seedConfig.scheduledCount * scale, startMs, endMs, (indexes) => {
    transact((txCtx) => createHeads(txCtx, "seed:scheduled", indexes, farFuture));
  });

  for (const typeName of seedConfig.runningTypes) {
    spreadBatches(seedConfig.runningPerType * scale, recentMs, endMs, (indexes) => {
      createThenAttempt(typeName, indexes, seedWorker);
    });
  }

  for (const typeName of seedConfig.completedTypes) {
    spreadBatches(seedConfig.completedPerType * scale, startMs, endMs, (indexes) => {
      createThenAttempt(typeName, indexes, seedWorker, (txCtx, job) => {
        stateAdapter.completeJobs({
          txCtx,
          jobs: [
            {
              jobId: job.id,
              output: { ok: true, index: (job.input as { index: number }).index },
              attemptToken: job.attemptToken!,
              workerId: job.attemptBy!,
            },
          ],
        });
      });
    });
  }

  spreadBatches(seedConfig.retriedCount * scale, startMs, endMs, (indexes) => {
    createThenAttempt("seed:retried", indexes, seedWorker, (txCtx, job) => {
      stateAdapter.rescheduleJobs({
        txCtx,
        jobs: [
          {
            jobId: job.id,
            schedule: farFuture,
            error: "seeded transient failure",
            attemptToken: job.attemptToken!,
          },
        ],
      });
    });
  });

  const fanInBlockerChainIds: string[] = [];
  for (const tier of seedConfig.fanInTiers) {
    const blockerChainIds = transact((txCtx) =>
      createHeads(txCtx, `seed:blocker:gate:${tier.blockers}`, range(tier.blockers), farFuture),
    ).map((job) => job.chainId);
    fanInBlockerChainIds.push(...blockerChainIds);
    spreadBatches(tier.blocked * scale, startMs, endMs, (indexes) => {
      transact((txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: createHeads(txCtx, `seed:blocked:fanin:${tier.blockers}`, indexes).map(
            (job) => ({ jobId: job.id, blockedByChainIds: blockerChainIds }),
          ),
        }),
      );
    });
  }

  const fanOutBlockerChainIds: string[] = [];
  for (const tier of seedConfig.fanOutTiers) {
    const blockerChainIds = transact((txCtx) =>
      createHeads(
        txCtx,
        `seed:blocker:fanout:${tier.blockers}`,
        range(tier.blockers * scale),
        farFuture,
      ),
    ).map((job) => job.chainId);
    fanOutBlockerChainIds.push(...blockerChainIds);
    for (const [blockerIndex, blockerChainId] of blockerChainIds.entries()) {
      spreadBatches(tier.blockedPer, startMs, endMs, (indexes) => {
        transact((txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: createHeads(
              txCtx,
              `seed:blocked:fanout:${tier.blockers}`,
              indexes.map((index) => blockerIndex * tier.blockedPer + index),
            ).map((job) => ({ jobId: job.id, blockedByChainIds: [blockerChainId] })),
          }),
        );
      });
    }
  }

  spreadBatches(seedConfig.blocking * scale, startMs, endMs, (indexes) => {
    transact((txCtx) =>
      stateAdapter.addJobsBlockers({
        txCtx,
        jobBlockers: createHeads(txCtx, "seed:blocking", indexes).map((job) => ({
          jobId: job.id,
          blockedByChainIds: [fanInBlockerChainIds[0]],
        })),
      }),
    );
  });

  const chainLength = seedConfig.chainLength * scale;
  const [longChainHead] = transact((txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "seed:chain", input: { n: 0 } }],
    }),
  );
  for (let chainStep = 1; chainStep < chainLength; chainStep++) {
    events.schedule(startMs + Math.floor((chainStep * seedConfig.windowMs) / chainLength), () => {
      transact((txCtx) => {
        const [acquired] = claim(txCtx, "seed:chain", seedWorker, 1);
        stateAdapter.continueJobs({
          txCtx,
          jobs: [
            {
              id: stateAdapter.config.generateJobId(),
              typeName: "seed:chain",
              input: { n: chainStep },
              continueFromId: acquired.id,
              attemptToken: acquired.attemptToken!,
              workerId: acquired.attemptBy!,
            },
          ],
        });
      });
    });
  }

  events.schedule(endMs - seedConfig.recentMs / 2, () => {
    createThenAttempt("seed:busy", range(seedConfig.workerConcurrency), busyWorker);
  });

  spreadBatches(seedConfig.throwawayPending * scale, startMs, endMs, (indexes) => {
    transact((txCtx) => createHeads(txCtx, "seed:throwaway:pending", indexes));
  });

  spreadBatches(seedConfig.throwawayRunning * scale, recentMs, endMs, (indexes) => {
    createThenAttempt("seed:throwaway:running", indexes, seedWorker);
  });

  events.schedule(endMs - seedConfig.recentMs / 4, () => {
    const expiredWorker = startWorker(
      seedConfig.expiredWorkerId,
      seedConfig.expiredWorkerTypeNames,
      {
        leaseMs: seedConfig.leaseMs,
      },
    );
    const indexes = range(seedConfig.throwawayExpiredRunning * scale);
    transact((txCtx) => {
      createHeads(txCtx, "seed:throwaway:expired", indexes);
      claim(txCtx, "seed:throwaway:expired", expiredWorker, indexes.length);
    });
    stateAdapter.extendWorkerLease({
      workerId: expiredWorker.id,
      workerToken: expiredWorker.token,
      leaseMs: 1,
    });
  });

  spreadBatches(seedConfig.throwawayChains * scale, startMs, endMs, (indexes) => {
    transact((txCtx) => createHeads(txCtx, "seed:throwaway:chain", indexes));
  });

  events.schedule(endMs - seedConfig.recentMs / 2, () => {
    const indexes = range(seedConfig.throwawayUnblockers * scale);
    transact((txCtx) => {
      const unblockers = createHeads(txCtx, "seed:throwaway:unblocker", indexes);
      const targets = createHeads(txCtx, "seed:throwaway:unblock-target", indexes);
      stateAdapter.addJobsBlockers({
        txCtx,
        jobBlockers: targets.map((target, index) => ({
          jobId: target.id,
          blockedByChainIds: [unblockers[index].chainId],
        })),
      });
    });
  });

  const typeWeights = Array.from({ length: background.typeCount }, (_, index) => 1 / (index + 1));
  const totalTypeWeight = typeWeights.reduce((sum, weight) => sum + weight, 0);
  const backgroundTypeName = (index: number): string => `seed:bg:${index}`;
  const pickBackgroundTypeName = (): string => {
    let remaining = random() * totalTypeWeight;
    for (const [index, weight] of typeWeights.entries()) {
      remaining -= weight;
      if (remaining < 0) return backgroundTypeName(index);
    }
    return backgroundTypeName(background.typeCount - 1);
  };
  const backgroundWorkers = Array.from({ length: background.workerCount }, (_, workerIndex) =>
    startWorker(
      `00000000-0000-4000-8000-1000000000${String(workerIndex).padStart(2, "0")}`,
      typeWeights
        .map((_, index) => backgroundTypeName(index))
        .filter((_, index) => index % background.workerCount === workerIndex),
      { concurrency: background.workerConcurrency },
    ),
  );
  const backgroundWorkerFor = (typeName: string): StateWorkerInfo =>
    backgroundWorkers[Number(typeName.slice("seed:bg:".length)) % background.workerCount];
  const backgroundChainIds: string[] = [];

  const scheduleBackgroundAttempt = (typeName: string, dueMs: number): void => {
    if (random() < background.backlogProbability) return;
    events.schedule(Math.max(dueMs, clock.nowMs) + exponential(seedConfig.attemptLatencyMs), () => {
      attemptBackgroundJob(typeName);
    });
  };

  const finishBackgroundJob = (job: StateJob): void => {
    const roll = random();
    if (roll < background.failureProbability) {
      const [rescheduled] = transact((txCtx) =>
        stateAdapter.rescheduleJobs({
          txCtx,
          jobs: [
            {
              jobId: job.id,
              schedule: { afterMs: Math.min(1000 * 2 ** job.attempt, background.maxBackoffMs) },
              error: pick(background.errors),
              attemptToken: job.attemptToken!,
            },
          ],
        }),
      );
      scheduleBackgroundAttempt(job.typeName, rescheduled!.scheduledAt.getTime());
      return;
    }
    if (
      job.chainIndex + 1 < background.maxChainLength &&
      random() < background.continueProbability
    ) {
      const typeName = pickBackgroundTypeName();
      transact((txCtx) =>
        stateAdapter.continueJobs({
          txCtx,
          jobs: [
            {
              id: stateAdapter.config.generateJobId(),
              typeName,
              input: { index: job.chainIndex + 1 },
              continueFromId: job.id,
              attemptToken: job.attemptToken!,
              workerId: job.attemptBy!,
              ...(job.traceContext === null ? {} : { traceContext: traceContext() }),
            },
          ],
        }),
      );
      scheduleBackgroundAttempt(typeName, clock.nowMs);
      return;
    }
    const dependents = transact((txCtx) => {
      stateAdapter.completeJobs({
        txCtx,
        jobs: [
          {
            jobId: job.id,
            output: { ok: true },
            attemptToken: job.attemptToken!,
            workerId: job.attemptBy!,
          },
        ],
      });
      return stateAdapter.unblockJobs({ txCtx, blockedByChainId: job.chainId });
    });
    const unblocked = new Map(dependents.map((dependent) => [dependent.jobId, dependent.job]));
    for (const dependent of unblocked.values()) {
      if (dependent.status === "pending") {
        scheduleBackgroundAttempt(dependent.typeName, dependent.scheduledAt.getTime());
      }
    }
  };

  const attemptBackgroundJob = (typeName: string): void => {
    const [job] = transact((txCtx) => claim(txCtx, typeName, backgroundWorkerFor(typeName), 1));
    if (job === undefined) return;
    events.schedule(clock.nowMs + exponential(seedConfig.attemptDurationMs), () => {
      finishBackgroundJob(job);
    });
  };

  const arriveBackgroundChain = (index: number): void => {
    const typeName = pickBackgroundTypeName();
    const deduplication =
      random() < background.deduplicationProbability
        ? {
            key: `key-${Math.floor(random() * background.deduplicationKeysPerType)}`,
            scope: random() < 0.5 ? ("running" as const) : ("any" as const),
          }
        : undefined;
    const schedule =
      random() < background.scheduleProbability
        ? { afterMs: exponential(background.scheduleMeanMs) }
        : undefined;
    const traced = random() < background.traceContextProbability;
    const blockerChainIds =
      backgroundChainIds.length > 0 && random() < background.blockerProbability
        ? [
            ...new Set(
              Array.from({ length: 1 + Math.floor(random() * background.maxBlockers) }, () =>
                pick(backgroundChainIds),
              ),
            ),
          ]
        : [];
    const head = transact((txCtx) => {
      const [chain] = stateAdapter.createJobs({
        txCtx,
        jobs: [
          {
            id: stateAdapter.config.generateJobId(),
            typeName,
            input: { index },
            ...(deduplication === undefined ? {} : { deduplication }),
            ...(schedule === undefined ? {} : { schedule }),
            ...(traced ? { traceContext: traceContext(), chainTraceContext: traceContext() } : {}),
          },
        ],
      });
      if (chain.deduplicated) return undefined;
      if (blockerChainIds.length === 0) return chain.head;
      const [blocked] = stateAdapter.addJobsBlockers({
        txCtx,
        jobBlockers: [
          {
            jobId: chain.head.id,
            blockedByChainIds: blockerChainIds,
            ...(traced ? { blockerTraceContexts: blockerChainIds.map(() => traceContext()) } : {}),
          },
        ],
      });
      return blocked;
    });
    if (head === undefined) return;
    backgroundChainIds.push(head.chainId);
    if (head.status === "pending") scheduleBackgroundAttempt(typeName, head.scheduledAt.getTime());
  };

  for (let index = 0; index < background.chainsPerScale * scale; index++) {
    events.schedule(randomTime(startMs, endMs), () => {
      arriveBackgroundChain(index);
    });
  }

  for (
    let event = events.next();
    event !== undefined && event.atMs <= endMs;
    event = events.next()
  ) {
    clock.nowMs = Math.max(clock.nowMs, event.atMs);
    event.run();
  }
  clock.nowMs = endMs;

  const firstJobIds = (typeName: string, status: StateJobStatus, limit = 1): string[] =>
    stateAdapter
      .listJobs({ typeName, status, orderBy: "createdAt", orderDirection: "asc", page: { limit } })
      .items.map((job) => job.id);
  const chainIdsOf = (typeName: string): string[] =>
    stateAdapter
      .listChains({
        typeName,
        orderBy: "createdAt",
        orderDirection: "asc",
        page: { limit: Number.MAX_SAFE_INTEGER },
      })
      .items.map((chain) => chain.id);

  const [longChainTail] = stateAdapter.listChainJobs({
    chainId: longChainHead.id,
    orderDirection: "desc",
    page: { limit: 1 },
  }).items;

  return {
    dump: dumpState(),
    sentinels: {
      pending: {
        jobId: firstJobIds(seedConfig.pendingTypes[0], "pending")[0],
        typeNames: [...seedConfig.pendingTypes],
      },
      scheduled: {
        jobId: firstJobIds("seed:scheduled", "pending")[0],
        typeName: "seed:scheduled",
      },
      running: {
        jobId: firstJobIds(seedConfig.runningTypes[0], "running")[0],
        typeNames: [...seedConfig.runningTypes],
      },
      completed: {
        jobId: firstJobIds(seedConfig.completedTypes[0], "completed")[0],
        typeNames: [...seedConfig.completedTypes],
      },
      retried: {
        jobId: firstJobIds("seed:retried", "pending")[0],
        typeName: "seed:retried",
      },
      longChain: {
        chainId: longChainHead.id,
        length: chainLength,
        headJobId: longChainHead.id,
        tailJobId: longChainTail.id,
      },
      fanIn: {
        blockerChainIds: fanInBlockerChainIds,
        blockedCount: seedConfig.fanInTiers.reduce((sum, tier) => sum + tier.blocked * scale, 0),
        blockersPerJob: seedConfig.fanInTiers[seedConfig.fanInTiers.length - 1].blockers,
        blockedJobId: firstJobIds("seed:blocked:fanin:1", "blocked")[0],
      },
      fanOut: {
        blockerChainId: fanOutBlockerChainIds[0],
        blockedJobIds: firstJobIds("seed:blocked:fanout:1", "blocked", 10),
        blockedCount: seedConfig.fanOutTiers.reduce(
          (sum, tier) => sum + tier.blockers * scale * tier.blockedPer,
          0,
        ),
      },
      blocking: {
        chainId: firstJobIds("seed:blocking", "blocked")[0],
        count: seedConfig.blocking * scale,
      },
      workers: {
        idleWorkerIds: seedConfig.idleWorkers.map((idleWorker) => idleWorker.id),
        busyWorkerId: seedConfig.busyWorkerId,
      },
      throwaway: {
        pendingTypeName: "seed:throwaway:pending",
        runningTypeName: "seed:throwaway:running",
        expiredRunningTypeName: "seed:throwaway:expired",
        chainIds: chainIdsOf("seed:throwaway:chain"),
        unblockerChainIds: chainIdsOf("seed:throwaway:unblocker"),
      },
    },
  };
};
