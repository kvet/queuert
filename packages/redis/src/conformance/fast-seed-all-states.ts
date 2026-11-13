import { type SeedSentinels, seedConfig } from "queuert/conformance-internal";

import { encodeRecord } from "../state-adapter/redis-transaction.ts";
import {
  type IndexEntries,
  createRedisSchema,
  opaqueRecordFields,
} from "../state-adapter/schema.redis.ts";
import {
  type StoredJob,
  type StoredWorker,
  nextSeq,
} from "../state-adapter/state-adapter.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";

const WRITE_SCRIPT = `
local cursor = 1
local function take()
  local value = ARGV[cursor]
  cursor = cursor + 1
  return value
end
local version = redis.call('INCR', KEYS[1])
local setVersionsKey = take()
for _ = 1, tonumber(take()) do
  local key = take()
  local data = take()
  local opaque = take()
  if opaque == '' then
    redis.call('HSET', key, 'v', version, 'd', data)
  else
    redis.call('HSET', key, 'v', version, 'd', data, 'u', opaque)
  end
end
for _ = 1, tonumber(take()) do
  local key = take()
  local member = take()
  redis.call('ZADD', key, take(), member)
end
for _ = 1, tonumber(take()) do
  local key = take()
  if redis.call('SADD', key, take()) == 1 then
    redis.call('HSET', setVersionsKey, key, version)
  end
end
for _ = 1, tonumber(take()) do
  local key = take()
  redis.call('HINCRBY', key, take(), 1)
end
return 1
`;

const WRITE_BATCH_ARGUMENTS = 50_000;

export const fastSeedAllStates = async (
  stateProvider: RedisStateProvider,
  { scale = 1, keyPrefix = "{queuert}:" }: { scale?: number; keyPrefix?: string } = {},
): Promise<SeedSentinels> => {
  const schema = createRedisSchema(keyPrefix);
  const { keys } = schema;

  let records: string[] = [];
  let zsets: string[] = [];
  let sets: string[] = [];
  let counters: string[] = [];

  const flush = async () => {
    if (records.length === 0) return;
    await stateProvider.eval(
      WRITE_SCRIPT,
      [keys.sequence],
      [
        keys.setVersions,
        String(records.length / 3),
        ...records,
        String(zsets.length / 3),
        ...zsets,
        String(sets.length / 2),
        ...sets,
        String(counters.length / 2),
        ...counters,
      ],
    );
    records = [];
    zsets = [];
    sets = [];
    counters = [];
  };

  const write = async (key: string, record: StoredJob | StoredWorker, entries: IndexEntries) => {
    const [data, opaque] = encodeRecord(record, opaqueRecordFields);
    records.push(key, data, opaque ?? "");
    for (const [indexKey, member, score] of entries.zsets) {
      zsets.push(indexKey, member, String(score));
    }
    for (const [indexKey, member] of entries.sets) sets.push(indexKey, member);
    for (const [indexKey, field] of entries.counters) counters.push(indexKey, field);
    if (records.length + zsets.length + sets.length + counters.length >= WRITE_BATCH_ARGUMENTS) {
      await flush();
    }
  };

  const writeJob = async (job: StoredJob) =>
    write(keys.job(job.id), job, schema.jobIndexEntries(job));

  const writeJobs = async (jobs: StoredJob[]) => {
    for (const job of jobs) await writeJob(job);
  };

  const writeWorker = async (worker: StoredWorker) =>
    write(keys.worker(worker.id), worker, schema.workerIndexEntries(worker));

  const nowMs = Date.now();
  let clockMs = nowMs - 120_000;
  const tick = (stepMs = 1000) => (clockMs += stepMs);

  const newJob = ({
    id = crypto.randomUUID(),
    typeName,
    input,
    at,
    chainId,
    chainIndex = 0,
    scheduledAt = at,
  }: {
    id?: string;
    typeName: string;
    input: unknown;
    at: number;
    chainId?: string;
    chainIndex?: number;
    scheduledAt?: number;
  }): StoredJob => ({
    id,
    typeName,
    chainId: chainId ?? id,
    chainIndex,
    chainStatus: chainIndex === 0 ? "running" : null,
    chainCompletedAt: null,
    continuedToId: null,
    input,
    output: null,
    status: "pending",
    createdAt: at,
    scheduledAt,
    completedAt: null,
    completedBy: null,
    attempt: 0,
    lastAttemptError: null,
    lastAttemptAt: null,
    attemptBy: null,
    attemptToken: null,
    attemptAt: null,
    deduplicationKey: null,
    chainTraceContext: null,
    traceContext: null,
    seq: nextSeq(new Date(at)),
    blockers: [],
  });

  const heads = (
    typeName: string,
    total: number,
    at: number,
    { scheduledAt = at, firstIndex = 0 }: { scheduledAt?: number; firstIndex?: number } = {},
  ): StoredJob[] =>
    Array.from({ length: total }, (_, i) =>
      newJob({ typeName, input: { index: firstIndex + i }, at, scheduledAt }),
    );

  const running = (job: StoredJob, workerId: string, at: number): StoredJob => ({
    ...job,
    status: "running",
    attempt: job.attempt + 1,
    attemptAt: at,
    attemptBy: workerId,
    attemptToken: crypto.randomUUID(),
  });

  const blocked = (job: StoredJob, blockedByChainIds: string[]): StoredJob => ({
    ...job,
    status: "blocked",
    blockers: blockedByChainIds.map((blockedByChainId, index) => ({
      blockedByChainId,
      index,
      traceContext: null,
    })),
  });

  const newWorker = (
    id: string,
    typeNames: readonly string[],
    startedAt: number,
    leaseUntil = startedAt + seedConfig.leaseMs,
  ): StoredWorker => ({
    id,
    typeNames: [...typeNames],
    concurrency: seedConfig.workerConcurrency,
    startedAt,
    leaseUntil,
    token: crypto.randomUUID(),
  });

  const workersAt = tick();
  await writeWorker(newWorker(seedConfig.workerId, seedConfig.workerTypeNames, workersAt));
  for (const idleWorker of seedConfig.idleWorkers) {
    await writeWorker(newWorker(idleWorker.id, idleWorker.typeNames, workersAt));
  }
  await writeWorker(newWorker(seedConfig.busyWorkerId, seedConfig.busyWorkerTypeNames, workersAt));

  const pendingJobIds: string[] = [];
  for (const typeName of seedConfig.pendingTypes) {
    const jobs = heads(typeName, seedConfig.pendingPerType * scale, tick());
    pendingJobIds.push(jobs[0].id);
    await writeJobs(jobs);
  }

  const scheduledAt = tick();
  const scheduled = heads("seed:scheduled", seedConfig.scheduledCount * scale, scheduledAt, {
    scheduledAt: scheduledAt + seedConfig.futureMs,
  });
  await writeJobs(scheduled);

  const runningJobIds: string[] = [];
  for (const typeName of seedConfig.runningTypes) {
    const at = tick();
    const jobs = heads(typeName, seedConfig.runningPerType * scale, at).map((job) =>
      running(job, seedConfig.workerId, at),
    );
    runningJobIds.push(jobs[0].id);
    await writeJobs(jobs);
  }

  const completedJobIds: string[] = [];
  for (const typeName of seedConfig.completedTypes) {
    const at = tick();
    const jobs = heads(typeName, seedConfig.completedPerType * scale, at).map((job): StoredJob => ({
      ...job,
      status: "completed",
      attempt: 1,
      output: { ok: true, index: (job.input as { index: number }).index },
      completedAt: at,
      completedBy: seedConfig.workerId,
      chainStatus: "completed",
      chainCompletedAt: at,
    }));
    completedJobIds.push(jobs[0].id);
    await writeJobs(jobs);
  }

  const retriedAt = tick();
  const retried = heads("seed:retried", seedConfig.retriedCount * scale, retriedAt).map(
    (job): StoredJob => ({
      ...job,
      attempt: 1,
      scheduledAt: retriedAt + seedConfig.futureMs,
      lastAttemptAt: retriedAt,
      lastAttemptError: "seeded transient failure",
    }),
  );
  await writeJobs(retried);

  const fanInBlockerChainIds: string[] = [];
  let fanInBlockedJobId: string | undefined;
  let fanInBlockedCount = 0;
  for (const tier of seedConfig.fanInTiers) {
    const blockersAt = tick();
    const tierBlockers = heads(`seed:blocker:gate:${tier.blockers}`, tier.blockers, blockersAt, {
      scheduledAt: blockersAt + seedConfig.futureMs,
    });
    await writeJobs(tierBlockers);
    const tierBlockerChainIds = tierBlockers.map((job) => job.chainId);
    fanInBlockerChainIds.push(...tierBlockerChainIds);

    const tierBlocked = heads(
      `seed:blocked:fanin:${tier.blockers}`,
      tier.blocked * scale,
      tick(),
    ).map((job) => blocked(job, tierBlockerChainIds));
    fanInBlockedJobId ??= tierBlocked[0].id;
    await writeJobs(tierBlocked);
    fanInBlockedCount += tierBlocked.length;
  }

  let fanOutBlockerChainId: string | undefined;
  const fanOutBlockedJobIds: string[] = [];
  let fanOutBlockedCount = 0;
  for (const tier of seedConfig.fanOutTiers) {
    const blockersAt = tick();
    const tierBlockers = heads(
      `seed:blocker:fanout:${tier.blockers}`,
      tier.blockers * scale,
      blockersAt,
      { scheduledAt: blockersAt + seedConfig.futureMs },
    );
    await writeJobs(tierBlockers);
    fanOutBlockerChainId ??= tierBlockers[0].chainId;

    const blockedAt = tick();
    for (const [blockerIndex, blocker] of tierBlockers.entries()) {
      const tierBlocked = heads(
        `seed:blocked:fanout:${tier.blockers}`,
        tier.blockedPer,
        blockedAt,
        {
          firstIndex: blockerIndex * tier.blockedPer,
        },
      ).map((job) => blocked(job, [blocker.chainId]));
      for (const job of tierBlocked) {
        if (fanOutBlockedJobIds.length < 10) fanOutBlockedJobIds.push(job.id);
      }
      await writeJobs(tierBlocked);
      fanOutBlockedCount += tierBlocked.length;
    }
  }

  const nonIndependentCount = seedConfig.nonIndependent * scale;
  const nonIndependent = heads("seed:nonindep", nonIndependentCount, tick()).map((job) =>
    blocked(job, [fanInBlockerChainIds[0]]),
  );
  await writeJobs(nonIndependent);

  const chainLength = seedConfig.chainLength * scale;
  const longChainIds = Array.from({ length: chainLength }, () => crypto.randomUUID());
  const longChainId = longChainIds[0];
  let chainStepAt = tick();
  for (const [step, id] of longChainIds.entries()) {
    const job = newJob({
      id,
      typeName: "seed:chain",
      input: { n: step },
      at: chainStepAt,
      chainId: longChainId,
      chainIndex: step,
    });
    const isTail = step === chainLength - 1;
    chainStepAt = tick(1);
    await writeJob(
      isTail
        ? job
        : {
            ...job,
            status: "completed",
            attempt: 1,
            continuedToId: longChainIds[step + 1],
            completedAt: chainStepAt,
            completedBy: seedConfig.workerId,
          },
    );
  }

  const busyAt = tick();
  await writeJobs(
    heads("seed:busy", seedConfig.workerConcurrency, busyAt).map((job) =>
      running(job, seedConfig.busyWorkerId, busyAt),
    ),
  );

  await writeJobs(heads("seed:throwaway:pending", seedConfig.throwawayPending * scale, tick()));

  const throwawayRunningAt = tick();
  await writeJobs(
    heads("seed:throwaway:running", seedConfig.throwawayRunning * scale, throwawayRunningAt).map(
      (job) => running(job, seedConfig.workerId, throwawayRunningAt),
    ),
  );

  const expiredAt = tick();
  await writeWorker(
    newWorker(
      seedConfig.expiredWorkerId,
      seedConfig.expiredWorkerTypeNames,
      expiredAt,
      expiredAt + 1,
    ),
  );
  await writeJobs(
    heads("seed:throwaway:expired", seedConfig.throwawayExpiredRunning * scale, expiredAt).map(
      (job) => running(job, seedConfig.expiredWorkerId, expiredAt),
    ),
  );

  const throwawayChains = heads("seed:throwaway:chain", seedConfig.throwawayChains * scale, tick());
  await writeJobs(throwawayChains);

  const unblockersAt = tick();
  const unblockers = heads(
    "seed:throwaway:unblocker",
    seedConfig.throwawayUnblockers * scale,
    unblockersAt,
  );
  await writeJobs(unblockers);
  await writeJobs(
    heads("seed:throwaway:unblock-target", unblockers.length, unblockersAt).map((job, i) =>
      blocked(job, [unblockers[i].chainId]),
    ),
  );

  await flush();

  return {
    pending: {
      jobId: pendingJobIds[0],
      typeNames: [...seedConfig.pendingTypes],
    },
    scheduled: {
      jobId: scheduled[0].id,
      typeName: "seed:scheduled",
    },
    running: {
      jobId: runningJobIds[0],
      typeNames: [...seedConfig.runningTypes],
    },
    completed: {
      jobId: completedJobIds[0],
      typeNames: [...seedConfig.completedTypes],
    },
    retried: {
      jobId: retried[0].id,
      typeName: "seed:retried",
    },
    longChain: {
      chainId: longChainId,
      length: chainLength,
      headJobId: longChainId,
      tailJobId: longChainIds[chainLength - 1],
    },
    fanIn: {
      blockerChainIds: fanInBlockerChainIds,
      blockedCount: fanInBlockedCount,
      blockersPerJob: seedConfig.fanInTiers[seedConfig.fanInTiers.length - 1].blockers,
      blockedJobId: fanInBlockedJobId!,
    },
    fanOut: {
      blockerChainId: fanOutBlockerChainId!,
      blockedJobIds: fanOutBlockedJobIds,
      blockedCount: fanOutBlockedCount,
    },
    nonIndependent: {
      chainId: nonIndependent[0].chainId,
      count: nonIndependentCount,
    },
    workers: {
      idleWorkerIds: seedConfig.idleWorkers.map((idleWorker) => idleWorker.id),
      busyWorkerId: seedConfig.busyWorkerId,
    },
    throwaway: {
      pendingTypeName: "seed:throwaway:pending",
      runningTypeName: "seed:throwaway:running",
      expiredRunningTypeName: "seed:throwaway:expired",
      chainIds: throwawayChains.map((job) => job.chainId),
      unblockerChainIds: unblockers.map((job) => job.chainId),
    },
  };
};
