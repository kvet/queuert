import {
  type BaseTxContext,
  type StateAdapter,
  type StateJob,
  type StateJobInfo,
} from "../state-adapter/state-adapter.js";

export type SeedSentinelsV2 = {
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
  nonIndependent: {
    chainId: string;
    count: number;
  };
  throwaway: {
    pendingTypeName: string;
    runningTypeName: string;
    expiredRunningTypeName: string;
    chainIds: string[];
    unblockerChainIds: string[];
  };
};

export const seedConfigV2 = {
  workerId: "seed-worker",
  attemptMs: 3600000, // 60 * 60 * 1000
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
  nonIndependent: 200,
  throwawayPending: 50,
  throwawayRunning: 20,
  throwawayExpiredRunning: 20,
  throwawayChains: 20,
  throwawayUnblockers: 20,
} as const;

const CREATE_CHUNK = 1000;
const PROCESS_CHUNK = 200;

const chunkIndexes = (total: number, size: number): number[][] => {
  const chunks: number[][] = [];
  for (let start = 0; start < total; start += size) {
    chunks.push(Array.from({ length: Math.min(size, total - start) }, (_, i) => start + i));
  }
  return chunks;
};

export const seedAllStatesV2 = async <TTxContext extends BaseTxContext>(
  stateAdapter: StateAdapter<TTxContext, string>,
  { scale = 1 }: { scale?: number } = {},
): Promise<SeedSentinelsV2> => {
  const headJob = (typeName: string, index: number, schedule?: { afterMs: number }) => ({
    typeName,
    input: { index },
    ...(schedule ? { schedule } : {}),
  });

  const createRoots = async (
    typeName: string,
    total: number,
    schedule?: { afterMs: number },
  ): Promise<StateJobInfo[]> => {
    const created: StateJobInfo[] = [];
    for (const indexes of chunkIndexes(total, CREATE_CHUNK)) {
      const results = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: indexes.map((i) => headJob(typeName, i, schedule)),
        }),
      );
      created.push(...results.map((r) => r.head));
    }
    return created;
  };

  const createProcessed = async (
    typeName: string,
    total: number,
    mode: "running" | "completed" | "retried",
  ): Promise<StateJob[]> => {
    const processed: StateJob[] = [];
    for (const indexes of chunkIndexes(total, PROCESS_CHUNK)) {
      const batch = await stateAdapter.withTransaction(async (txCtx) => {
        await stateAdapter.createJobs({
          txCtx,
          jobs: indexes.map((i) => headJob(typeName, i)),
        });
        const jobs: StateJob[] = [];
        for (let k = 0; k < indexes.length; k++) {
          const acquired = await stateAdapter.startJobAttempt({
            txCtx,
            typeNames: [typeName],
            workerId: seedConfigV2.workerId,
          });
          if (!acquired) break;
          const job = acquired;
          if (mode === "running") {
            jobs.push(
              await stateAdapter.extendJobAttempt({
                txCtx,
                jobId: job.id,
                workerId: seedConfigV2.workerId,
                timeoutMs: seedConfigV2.attemptMs,
              }),
            );
          } else if (mode === "completed") {
            const completed = await stateAdapter.completeJobs({
              txCtx,
              completedBy: seedConfigV2.workerId,
              jobs: [
                {
                  jobId: job.id,
                  output: { ok: true, index: (job.input as { index: number }).index },
                },
              ],
            });
            jobs.push(...completed);
          } else {
            const [rescheduled] = await stateAdapter.rescheduleJobs({
              txCtx,
              jobs: [
                {
                  jobId: job.id,
                  schedule: { afterMs: seedConfigV2.futureMs },
                  error: "seeded transient failure",
                },
              ],
            });
            jobs.push(rescheduled!);
          }
        }
        return jobs;
      });
      processed.push(...batch);
    }
    return processed;
  };

  // --- Block: Pending jobs (created first = earlier createdAt) ---
  const pendingJobs: StateJobInfo[] = [];
  for (const typeName of seedConfigV2.pendingTypes) {
    const jobs = await createRoots(typeName, seedConfigV2.pendingPerType * scale);
    pendingJobs.push(...jobs);
  }

  // --- Block: Scheduled ---
  const scheduled = await createRoots("seed:scheduled", seedConfigV2.scheduledCount * scale, {
    afterMs: seedConfigV2.futureMs,
  });

  // --- Block: Running ---
  const runningJobs: StateJob[] = [];
  for (const typeName of seedConfigV2.runningTypes) {
    const jobs = await createProcessed(typeName, seedConfigV2.runningPerType * scale, "running");
    runningJobs.push(...jobs);
  }

  // --- Block: Completed (non-continued, created before continued ones) ---
  const completedJobs: StateJob[] = [];
  for (const typeName of seedConfigV2.completedTypes) {
    const jobs = await createProcessed(
      typeName,
      seedConfigV2.completedPerType * scale,
      "completed",
    );
    completedJobs.push(...jobs);
  }

  // --- Block: Retried ---
  const retried = await createProcessed(
    "seed:retried",
    seedConfigV2.retriedCount * scale,
    "retried",
  );

  // --- Block: Fan-in (tiered: many×1, medium×10, few×100) ---
  const fanInBlockerChains: StateJobInfo[] = [];
  const fanInBlocked: StateJobInfo[] = [];
  let fanInBlockedCount = 0;

  for (const tier of seedConfigV2.fanInTiers) {
    const tierBlockerName = `seed:blocker:gate:${tier.blockers}`;
    const tierBlockedName = `seed:blocked:fanin:${tier.blockers}`;

    const tierBlockers: StateJobInfo[] = [];
    for (const indexes of chunkIndexes(tier.blockers, CREATE_CHUNK)) {
      const results = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: indexes.map((i) => headJob(tierBlockerName, i, { afterMs: seedConfigV2.futureMs })),
        }),
      );
      tierBlockers.push(...results.map((r) => r.head));
    }
    fanInBlockerChains.push(...tierBlockers);

    for (const indexes of chunkIndexes(tier.blocked * scale, CREATE_CHUNK / 2)) {
      const batch = await stateAdapter.withTransaction(async (txCtx) => {
        const created = await stateAdapter.createJobs({
          txCtx,
          jobs: indexes.map((i) => headJob(tierBlockedName, i)),
        });
        await stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: created.map((r) => ({
            jobId: r.head.id,
            blockedByChainIds: tierBlockers.map((b) => b.chainId),
          })),
        });
        return created.map((r) => r.head);
      });
      fanInBlocked.push(...batch);
    }
    fanInBlockedCount += tier.blocked * scale;
  }

  // --- Block: Fan-out (tiered: 1→1000, 10→100, 100→10) ---
  let fanOutBlockerChainId: string | undefined;
  const fanOutBlocked: StateJobInfo[] = [];
  let fanOutBlockedCount = 0;

  for (const tier of seedConfigV2.fanOutTiers) {
    const tierBlockerName = `seed:blocker:fanout:${tier.blockers}`;
    const tierBlockedName = `seed:blocked:fanout:${tier.blockers}`;

    const tierBlockers: StateJobInfo[] = [];
    const scaledBlockers = tier.blockers * scale;
    for (const indexes of chunkIndexes(scaledBlockers, CREATE_CHUNK)) {
      const results = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: indexes.map((i) => headJob(tierBlockerName, i, { afterMs: seedConfigV2.futureMs })),
        }),
      );
      tierBlockers.push(...results.map((r) => r.head));
    }
    fanOutBlockerChainId ??= tierBlockers[0].chainId;

    for (let bIdx = 0; bIdx < tierBlockers.length; bIdx++) {
      const blocker = tierBlockers[bIdx];
      for (const indexes of chunkIndexes(tier.blockedPer, CREATE_CHUNK / 2)) {
        const batch = await stateAdapter.withTransaction(async (txCtx) => {
          const created = await stateAdapter.createJobs({
            txCtx,
            jobs: indexes.map((i) => headJob(tierBlockedName, bIdx * tier.blockedPer + i)),
          });
          await stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: created.map((r) => ({
              jobId: r.head.id,
              blockedByChainIds: [blocker.chainId],
            })),
          });
          return created.map((r) => r.head);
        });
        fanOutBlocked.push(...batch);
      }
    }
    fanOutBlockedCount += scaledBlockers * tier.blockedPer;
  }

  // --- Block: Non-independent chains (blocked by fan-in gate, created AFTER unblocked) ---
  const nonIndependentCount = seedConfigV2.nonIndependent * scale;
  const nonIndependent: StateJobInfo[] = [];
  for (const indexes of chunkIndexes(nonIndependentCount, CREATE_CHUNK / 2)) {
    const batch = await stateAdapter.withTransaction(async (txCtx) => {
      const created = await stateAdapter.createJobs({
        txCtx,
        jobs: indexes.map((i) => headJob("seed:nonindep", i)),
      });
      await stateAdapter.addJobsBlockers({
        txCtx,
        jobBlockers: created.map((r) => ({
          jobId: r.head.id,
          blockedByChainIds: [fanInBlockerChains[0].chainId],
        })),
      });
      return created.map((r) => r.head);
    });
    nonIndependent.push(...batch);
  }

  // --- Block: Long chain with continuations ---
  const chainLength = seedConfigV2.chainLength * scale;
  const [chainRootChain] = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: [{ typeName: "seed:chain", input: { n: 0 } }],
    }),
  );
  let lastChainJob = chainRootChain.head;
  for (let step = 1; step < chainLength; step++) {
    await stateAdapter.withTransaction(async (txCtx) => {
      const acquired = await stateAdapter.startJobAttempt({
        txCtx,
        typeNames: ["seed:chain"],
        workerId: seedConfigV2.workerId,
      });
      if (!acquired) return;
      const [{ continuation }] = await stateAdapter.continueJobs({
        txCtx,
        completedBy: seedConfigV2.workerId,
        jobs: [{ typeName: "seed:chain", input: { n: step }, continueFromId: acquired.id }],
      });
      lastChainJob = continuation;
    });
  }

  // --- Block: Throwaway inventory (consumed by operational query benchmarks) ---
  await createRoots("seed:throwaway:pending", seedConfigV2.throwawayPending * scale);
  await createProcessed("seed:throwaway:running", seedConfigV2.throwawayRunning * scale, "running");

  const throwawayExpiredRunning: StateJob[] = [];
  for (const indexes of chunkIndexes(seedConfigV2.throwawayExpiredRunning * scale, PROCESS_CHUNK)) {
    const batch = await stateAdapter.withTransaction(async (txCtx) => {
      await stateAdapter.createJobs({
        txCtx,
        jobs: indexes.map((i) => headJob("seed:throwaway:expired", i)),
      });
      const jobs: StateJob[] = [];
      for (let k = 0; k < indexes.length; k++) {
        const acquired = await stateAdapter.startJobAttempt({
          txCtx,
          typeNames: ["seed:throwaway:expired"],
          workerId: seedConfigV2.workerId,
        });
        if (!acquired) break;
        const job = acquired;
        jobs.push(
          await stateAdapter.extendJobAttempt({
            txCtx,
            jobId: job.id,
            workerId: seedConfigV2.workerId,
            timeoutMs: 1,
          }),
        );
      }
      return jobs;
    });
    throwawayExpiredRunning.push(...batch);
  }

  const throwawayChainResults = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: Array.from({ length: seedConfigV2.throwawayChains * scale }, (_, i) => ({
        typeName: "seed:throwaway:chain",
        input: { index: i },
      })),
    }),
  );

  const throwawayUnblockerResults = await stateAdapter.withTransaction(async (txCtx) => {
    const blockers = await stateAdapter.createJobs({
      txCtx,
      jobs: Array.from({ length: seedConfigV2.throwawayUnblockers * scale }, (_, i) => ({
        typeName: "seed:throwaway:unblocker",
        input: { index: i },
      })),
    });
    const targets = await stateAdapter.createJobs({
      txCtx,
      jobs: Array.from({ length: seedConfigV2.throwawayUnblockers * scale }, (_, i) => ({
        typeName: "seed:throwaway:unblock-target",
        input: { index: i },
      })),
    });
    await stateAdapter.addJobsBlockers({
      txCtx,
      jobBlockers: targets.map((t, i) => ({
        jobId: t.head.id,
        blockedByChainIds: [blockers[i].id],
      })),
    });
    return blockers;
  });

  return {
    pending: {
      jobId: pendingJobs[0].id,
      typeNames: [...seedConfigV2.pendingTypes],
    },
    scheduled: {
      jobId: scheduled[0].id,
      typeName: "seed:scheduled",
    },
    running: {
      jobId: runningJobs[0].id,
      typeNames: [...seedConfigV2.runningTypes],
    },
    completed: {
      jobId: completedJobs[0].id,
      typeNames: [...seedConfigV2.completedTypes],
    },
    retried: {
      jobId: retried[0].id,
      typeName: "seed:retried",
    },
    longChain: {
      chainId: chainRootChain.head.chainId,
      length: chainLength,
      headJobId: chainRootChain.head.id,
      tailJobId: lastChainJob.id,
    },
    fanIn: {
      blockerChainIds: fanInBlockerChains.map((j) => j.chainId),
      blockedCount: fanInBlockedCount,
      blockersPerJob: seedConfigV2.fanInTiers[seedConfigV2.fanInTiers.length - 1].blockers,
      blockedJobId: fanInBlocked[0].id,
    },
    fanOut: {
      blockerChainId: fanOutBlockerChainId!,
      blockedJobIds: fanOutBlocked.slice(0, 10).map((j) => j.id),
      blockedCount: fanOutBlockedCount,
    },
    nonIndependent: {
      chainId: nonIndependent[0].chainId,
      count: nonIndependentCount,
    },
    throwaway: {
      pendingTypeName: "seed:throwaway:pending",
      runningTypeName: "seed:throwaway:running",
      expiredRunningTypeName: "seed:throwaway:expired",
      chainIds: throwawayChainResults.map((r) => r.id),
      unblockerChainIds: throwawayUnblockerResults.map((r) => r.id),
    },
  };
};
