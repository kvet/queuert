// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import { it as baseIt, describe, expect } from "vitest";

import { RedisTransactionConflictError } from "../errors.ts";
import { createRedisStateAdapter } from "../state-adapter/state-adapter.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";
import { createIoredisStateProvider } from "./state-provider.ioredis.ts";

const redis = await acquireRedis("redis:6");

const isCommitScript = (script: string): boolean => script.includes("local commitKey = take()");
const isClaimScript = (script: string): boolean => script.includes("local claimKey =");

const it = baseIt.extend("setup", async ({}, { onCleanup }) => {
  const client = new Redis(redis.connectionUrl);
  onCleanup(async () => {
    await client.quit();
  });
  const keyPrefix = `{queuert-${crypto.randomUUID()}}:`;
  const baseProvider = createIoredisStateProvider({ client });
  let intercept: RedisStateProvider["eval"] | undefined;
  const stateAdapter = createRedisStateAdapter({
    stateProvider: {
      eval: async (script, keys, args) =>
        intercept === undefined
          ? baseProvider.eval(script, keys, args)
          : intercept(script, keys, args),
    },
    keyPrefix,
    maxTransactionTries: 3,
  });
  await stateAdapter.migrateToLatest();
  const createJob = async (typeName = "task") => {
    const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ id: stateAdapter.config.generateJobId(), typeName, input: { typeName } }],
      }),
    );
    return chain.head.id;
  };
  const startWorker = async (typeName = "task") =>
    stateAdapter.startWorker({
      workerId: stateAdapter.config.generateWorkerId(),
      typeNames: [typeName],
      concurrency: 1,
      leaseMs: 60_000,
    });
  const setIntercept = (next: RedisStateProvider["eval"] | undefined) => {
    intercept = next;
  };
  return { client, keyPrefix, baseProvider, stateAdapter, createJob, startWorker, setIntercept };
});

describe("Redis state adapter reliability", () => {
  it("applies a commit once when the provider resends it", async ({ setup }) => {
    const { stateAdapter, baseProvider, setIntercept } = setup;
    setIntercept(async (script, keys, args) => {
      if (!isCommitScript(script)) return baseProvider.eval(script, keys, args);
      await baseProvider.eval(script, keys, args);
      return baseProvider.eval(script, keys, args);
    });
    let runs = 0;

    const [chain] = await stateAdapter.withTransaction(async (txCtx) => {
      runs++;
      return stateAdapter.createJobs({
        txCtx,
        jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
      });
    });
    setIntercept(undefined);

    expect(runs).toBe(1);
    expect((await stateAdapter.getJobs({ jobIds: [chain.head.id] }))[0]?.id).toBe(chain.head.id);
    expect(await stateAdapter.countJobsByTypeName({ typeNames: ["task"] })).toMatchObject([
      { pending: { count: 1 } },
    ]);
  });

  it("returns the same claimed jobs when the provider resends a claim", async ({ setup }) => {
    const { stateAdapter, baseProvider, setIntercept, createJob, startWorker } = setup;
    const firstJobId = await createJob();
    const secondJobId = await createJob();
    const worker = await startWorker();
    setIntercept(async (script, keys, args) => {
      if (!isClaimScript(script)) return baseProvider.eval(script, keys, args);
      await baseProvider.eval(script, keys, args);
      return baseProvider.eval(script, keys, args);
    });

    const claimed = await stateAdapter.startJobAttempts({
      workerId: worker.id,
      workerToken: worker.token,
      typeNames: ["task"],
      limit: 1,
    });
    setIntercept(undefined);

    expect(claimed.map((job) => job.id)).toEqual([firstJobId]);
    expect(claimed[0].input).toEqual({ typeName: "task" });
    const [first, second] = await stateAdapter.getJobs({ jobIds: [firstJobId, secondJobId] });
    expect(first).toMatchObject({ status: "running", attemptToken: claimed[0].attemptToken });
    expect(second).toMatchObject({ status: "pending" });
  });

  it("releases job locks when the commit fails", async ({ setup }) => {
    const { client, keyPrefix, stateAdapter, baseProvider, setIntercept, createJob } = setup;
    const jobId = await createJob();
    setIntercept(async (script, keys, args) => {
      if (isCommitScript(script)) throw new Error("connection reset");
      return baseProvider.eval(script, keys, args);
    });

    await expect(
      stateAdapter.withTransaction(async (txCtx) => {
        await stateAdapter.getJobs({ txCtx, jobIds: [jobId], lock: "exclusive" });
        await stateAdapter.completeJobs({ txCtx, jobs: [{ jobId, output: null }] });
      }),
    ).rejects.toThrow("connection reset");
    setIntercept(undefined);

    expect(await client.exists(`${keyPrefix}job-lock:${jobId}`)).toBe(0);
  });

  it("claims and reports a due job behind more locked jobs than one claim page", async ({
    setup,
  }) => {
    const { stateAdapter, createJob, startWorker } = setup;
    const lockedJobIds: string[] = [];
    for (let index = 0; index < 40; index++) lockedJobIds.push(await createJob());
    const freeJobId = await createJob();
    const worker = await startWorker();

    const [delayMs, claimed] = await stateAdapter.withTransaction(async (txCtx) => {
      await stateAdapter.getJobs({ txCtx, jobIds: lockedJobIds, lock: "exclusive" });
      const delay = await stateAdapter.getStartAttemptDelayMs({ typeNames: ["task"] });
      const jobs = await stateAdapter.startJobAttempts({
        workerId: worker.id,
        workerToken: worker.token,
        typeNames: ["task"],
        limit: 1,
      });
      return [delay, jobs] as const;
    });

    expect(delayMs).toBe(0);
    expect(claimed.map((job) => job.id)).toEqual([freeJobId]);
  });

  it("keeps the version checks of records a failed write read", async ({ setup }) => {
    const { stateAdapter, createJob } = setup;
    const jobId = await createJob();
    let runs = 0;

    await stateAdapter.withTransaction(async (txCtx) => {
      runs++;
      await stateAdapter
        .addJobsBlockers({
          txCtx,
          jobBlockers: [
            { jobId, blockedByChainIds: [] },
            { jobId: stateAdapter.config.generateJobId(), blockedByChainIds: [] },
          ],
        })
        .catch(() => undefined);
      if (runs === 1) {
        await stateAdapter.rescheduleJobs({ jobs: [{ jobId, schedule: { afterMs: 60_000 } }] });
      }
      await stateAdapter.createJobs({
        txCtx,
        jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "other", input: null }],
      });
    });

    expect(runs).toBe(2);
  });

  it("throws RedisTransactionConflictError when the last try fails on stale reads", async ({
    setup,
  }) => {
    const { stateAdapter, createJob } = setup;
    const jobId = await createJob();
    const failure = new Error("handler failed");

    const error = await stateAdapter
      .withTransaction(async (txCtx) => {
        await stateAdapter.getJobs({ txCtx, jobIds: [jobId] });
        await stateAdapter.rescheduleJobs({ jobs: [{ jobId, schedule: { afterMs: 60_000 } }] });
        throw failure;
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RedisTransactionConflictError);
    expect((error as RedisTransactionConflictError).tries).toBe(3);
    expect((error as Error).cause).toBe(failure);
  });

  it("claims a job whose error, trace contexts and blockers hold lone surrogates", async ({
    setup,
  }) => {
    const { stateAdapter, startWorker } = setup;
    const lone = "boom \ud83d";
    const [blocker] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocker", input: null }],
      }),
    );
    const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [
          {
            id: stateAdapter.config.generateJobId(),
            typeName: "task",
            input: lone,
            traceContext: lone,
            chainTraceContext: lone,
            deduplication: { key: lone, scope: "any" },
          },
        ],
      }),
    );
    await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.addJobsBlockers({
        txCtx,
        jobBlockers: [
          {
            jobId: chain.head.id,
            blockedByChainIds: [blocker.head.id],
            blockerTraceContexts: [lone],
          },
        ],
      }),
    );
    await stateAdapter.withTransaction(async (txCtx) => {
      await stateAdapter.completeJobs({ txCtx, jobs: [{ jobId: blocker.head.id, output: null }] });
      await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blocker.head.id });
    });
    const worker = await startWorker();
    const [first] = await stateAdapter.startJobAttempts({
      workerId: worker.id,
      workerToken: worker.token,
      typeNames: ["task"],
      limit: 1,
    });
    await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.rescheduleJobs({
        txCtx,
        jobs: [{ jobId: first.id, attemptToken: first.attemptToken!, error: lone }],
      }),
    );

    const [second] = await stateAdapter.startJobAttempts({
      workerId: worker.id,
      workerToken: worker.token,
      typeNames: ["task"],
      limit: 1,
    });

    expect(second).toMatchObject({
      id: chain.head.id,
      attempt: 2,
      lastAttemptError: lone,
      traceContext: lone,
      input: lone,
      hasBlockers: true,
      chain: { traceContext: lone, deduplicationKey: lone },
    });
  });

  it("rejects ids and type names with lone surrogates", async ({ setup }) => {
    const { stateAdapter } = setup;

    await expect(
      stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task\ud83d", input: null }],
        }),
      ),
    ).rejects.toThrow(/lone surrogate/);
    await expect(
      stateAdapter.startWorker({
        workerId: "worker\ud83d",
        typeNames: ["task"],
        concurrency: 1,
        leaseMs: 60_000,
      }),
    ).rejects.toThrow(/lone surrogate/);
  });
});
