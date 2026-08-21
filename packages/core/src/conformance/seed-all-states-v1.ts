import {
  type BaseTxContext,
  type StateAdapter,
  type StateJob,
} from "../state-adapter/state-adapter.js";

export type SeedSentinelsV1 = {
  pendingJobId: string;
  scheduledJobId: string;
  runningJobId: string;
  completedJobId: string;
  retriedJobId: string;
  blockedJobId: string;
  fanInBlockerId: string;
  fanInBlockedCount: number;
  chainId: string;
  chainLength: number;
};

const COUNTS = {
  pending: 4000,
  scheduled: 500,
  running: 500,
  completed: 1200,
  retried: 500,
  blocked: 3000,
  chain: 100,
} as const;

const WORKER_ID = "seed-worker";
const ATTEMPT_MS = 60 * 60 * 1000;
const FUTURE_MS = 24 * 60 * 60 * 1000;
const CREATE_CHUNK = 1000;
const PROCESS_CHUNK = 200;

const chunkIndexes = (total: number, size: number): number[][] => {
  const chunks: number[][] = [];
  for (let start = 0; start < total; start += size) {
    chunks.push(Array.from({ length: Math.min(size, total - start) }, (_, i) => start + i));
  }
  return chunks;
};

export const seedAllStatesV1 = async <TTxContext extends BaseTxContext>(
  stateAdapter: StateAdapter<TTxContext, string>,
): Promise<SeedSentinelsV1> => {
  const headJob = (typeName: string, index: number, schedule?: { afterMs: number }) => ({
    typeName,
    input: { index },
    ...(schedule ? { schedule } : {}),
  });

  const createRoots = async (
    typeName: string,
    total: number,
    schedule?: { afterMs: number },
  ): Promise<StateJob[]> => {
    const created: StateJob[] = [];
    for (const indexes of chunkIndexes(total, CREATE_CHUNK)) {
      const results = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createChains({
          txCtx,
          jobs: indexes.map((i) => headJob(typeName, i, schedule)),
        }),
      );
      created.push(...results.map((r) => r.job));
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
        await stateAdapter.createChains({
          txCtx,
          jobs: indexes.map((i) => headJob(typeName, i)),
        });
        const jobs: StateJob[] = [];
        for (let k = 0; k < indexes.length; k++) {
          const { job } = await stateAdapter.startJobAttempt({
            txCtx,
            typeNames: [typeName],
            workerId: WORKER_ID,
          });
          if (!job) break;
          if (mode === "running") {
            jobs.push(
              await stateAdapter.extendJobAttempt({
                txCtx,
                jobId: job.id,
                workerId: WORKER_ID,
                timeoutMs: ATTEMPT_MS,
              }),
            );
          } else if (mode === "completed") {
            jobs.push(
              await stateAdapter.finishJobAttempt({
                txCtx,
                jobId: job.id,
                workerId: WORKER_ID,
                outcome: { output: { ok: true, index: (job.input as { index: number }).index } },
              }),
            );
          } else {
            jobs.push(
              await stateAdapter.finishJobAttempt({
                txCtx,
                jobId: job.id,
                workerId: WORKER_ID,
                outcome: { error: "seeded transient failure", schedule: { afterMs: FUTURE_MS } },
              }),
            );
          }
        }
        return jobs;
      });
      processed.push(...batch);
    }
    return processed;
  };

  const pending = await createRoots("seed:pending", COUNTS.pending);
  const scheduled = await createRoots("seed:scheduled", COUNTS.scheduled, {
    afterMs: FUTURE_MS,
  });
  const running = await createProcessed("seed:running", COUNTS.running, "running");
  const completed = await createProcessed("seed:completed", COUNTS.completed, "completed");
  const retried = await createProcessed("seed:retried", COUNTS.retried, "retried");

  const [{ job: blocker }] = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.createChains({
      txCtx,
      jobs: [headJob("seed:blocker", 0, { afterMs: FUTURE_MS })],
    }),
  );
  const blocked: StateJob[] = [];
  for (const indexes of chunkIndexes(COUNTS.blocked, CREATE_CHUNK / 2)) {
    const batch = await stateAdapter.withTransaction(async (txCtx) => {
      const created = await stateAdapter.createChains({
        txCtx,
        jobs: indexes.map((i) => headJob("seed:blocked", i)),
      });
      await stateAdapter.addJobsBlockers({
        txCtx,
        jobBlockers: created.map(({ job }) => ({
          jobId: job.id,
          blockedByChainIds: [blocker.chainId],
        })),
      });
      return created.map((r) => r.job);
    });
    blocked.push(...batch);
  }

  const chainLength = COUNTS.chain;
  const [{ job: chainRoot }] = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.createChains({
      txCtx,
      jobs: [{ typeName: "seed:chain", input: { n: 0 } }],
    }),
  );
  for (let step = 1; step < chainLength; step++) {
    await stateAdapter.withTransaction(async (txCtx) => {
      const { job } = await stateAdapter.startJobAttempt({
        txCtx,
        typeNames: ["seed:chain"],
        workerId: WORKER_ID,
      });
      if (!job) return;
      const { job: continuation } = await stateAdapter.createContinuationJob({
        txCtx,
        job: {
          typeName: "seed:chain",
          input: { n: step },
          continueFromId: job.id,
        },
      });
      await stateAdapter.finishJobAttempt({
        txCtx,
        jobId: job.id,
        workerId: WORKER_ID,
        outcome: { continuedToId: continuation.id },
      });
    });
  }

  return {
    pendingJobId: pending[0].id,
    scheduledJobId: scheduled[0].id,
    runningJobId: running[0].id,
    completedJobId: completed[0].id,
    retriedJobId: retried[0].id,
    blockedJobId: blocked[0].id,
    fanInBlockerId: blocker.chainId,
    fanInBlockedCount: blocked.length,
    chainId: chainRoot.chainId,
    chainLength,
  };
};
