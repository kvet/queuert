import { sleep } from "../../helpers/sleep.js";
import {
  type StateAdapter,
  type StateAttemptFence,
  type StateJob,
} from "../../state-adapter/state-adapter.js";
import { type Expect } from "../expect.js";
import { type ConformanceCase, type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

const WORKER_ID = "fence-worker";

type FencedMethod = "completeJobs" | "continueJobs" | "rescheduleJobs" | "extendJobAttempt";

type FenceMiss = "wrong attempt" | "wrong worker" | "completed" | "missing";

const swapLastChar = (id: string): string => id.slice(0, -1) + (id.endsWith("0") ? "1" : "0");

/**
 * Creates a two-job chain and acquires its second job, so the job under test is not its
 * chain's head row: a fenced write that misses must leave the head untouched too.
 */
const setupRunningJob = async (
  stateAdapter: StateAdapter<any, any>,
  typeName: string,
): Promise<StateJob> => {
  const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.createJobs({ txCtx, jobs: [{ typeName: `${typeName}:head`, input: null }] }),
  );
  await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.continueJobs({
      txCtx,
      jobs: [{ typeName, input: { step: 2 }, continueFromId: chain.head.id }],
    }),
  );
  const acquired = await stateAdapter.startJobAttempt({
    workerId: WORKER_ID,
    timeoutMsByTypeName: { [typeName]: 30_000 },
  });
  return acquired!;
};

const runFenced = async (
  stateAdapter: StateAdapter<any, any>,
  method: FencedMethod,
  jobId: string,
  fence: StateAttemptFence,
  typeName: string,
): Promise<unknown> => {
  switch (method) {
    case "completeJobs": {
      const [result] = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.completeJobs({
          txCtx,
          completedBy: fence.workerId,
          jobs: [{ jobId, output: { fenced: true }, fence }],
        }),
      );
      return result;
    }
    case "continueJobs": {
      const [result] = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.continueJobs({
          txCtx,
          completedBy: fence.workerId,
          jobs: [{ typeName: `${typeName}:next`, input: null, continueFromId: jobId, fence }],
        }),
      );
      return result;
    }
    case "rescheduleJobs": {
      const [result] = await stateAdapter.rescheduleJobs({
        jobs: [{ jobId, schedule: { afterMs: 60_000 }, error: "fenced", fence }],
      });
      return result;
    }
    case "extendJobAttempt":
      return stateAdapter.extendJobAttempt({ jobId, fence, timeoutMs: 120_000 });
  }
};

const snapshot = async (stateAdapter: StateAdapter<any, any>, job: StateJob) => {
  const [storedJob] = await stateAdapter.getJobs({ jobIds: [job.id] });
  const [chain] = await stateAdapter.getChains({ chainIds: [job.chainId] });
  const chainJobs = await stateAdapter.listChainJobs({
    chainId: job.chainId,
    orderDirection: "asc",
    page: { limit: 10 },
  });
  return {
    job: storedJob,
    chain: chain && { ...chain, tail: undefined },
    chainJobIds: chainJobs.items.map((item) => item.id),
  };
};

const fenceMissCase = (
  method: FencedMethod,
  miss: FenceMiss,
): ConformanceCase<StateConformanceFixture> => ({
  name: `${method} with a fence misses for a ${miss} job and writes nothing`,
  run: async ({ stateAdapter }, expect) => {
    const typeName = `fence-${method}-${miss.replace(" ", "-")}`;
    const job = await setupRunningJob(stateAdapter, typeName);
    expect(job.attempt).toBe(1);

    let targetId = job.id;
    let fence: StateAttemptFence = { attempt: job.attempt, workerId: WORKER_ID };
    if (miss === "wrong attempt") fence = { attempt: job.attempt + 1, workerId: WORKER_ID };
    if (miss === "wrong worker") fence = { attempt: job.attempt, workerId: "other-worker" };
    if (miss === "missing") targetId = swapLastChar(job.id);
    if (miss === "completed") {
      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.completeJobs({
          txCtx,
          completedBy: null,
          jobs: [{ jobId: job.id, output: { takenOver: true } }],
        }),
      );
    }

    const before = await snapshot(stateAdapter, job);
    const result = await runFenced(stateAdapter, method, targetId, fence, typeName);
    expect(result).toBeUndefined();
    const after = await snapshot(stateAdapter, job);

    expect(after).toEqual(before);
  },
});

const fenceMatchCase = (method: FencedMethod): ConformanceCase<StateConformanceFixture> => ({
  name: `${method} with a fence matching the running attempt writes`,
  run: async ({ stateAdapter }, expect) => {
    const typeName = `fence-${method}-match`;
    const job = await setupRunningJob(stateAdapter, typeName);

    const result = await runFenced(
      stateAdapter,
      method,
      job.id,
      { attempt: job.attempt, workerId: WORKER_ID },
      typeName,
    );
    expect(result).toBeDefined();

    const [stored] = await stateAdapter.getJobs({ jobIds: [job.id] });
    const [chain] = await stateAdapter.getChains({ chainIds: [job.chainId] });
    const chainJobs = await stateAdapter.listChainJobs({
      chainId: job.chainId,
      orderDirection: "asc",
      page: { limit: 10 },
    });
    switch (method) {
      case "completeJobs":
        expect(stored!.status).toBe("completed");
        expect(stored!.output).toEqual({ fenced: true });
        expect(chain!.status).toBe("completed");
        break;
      case "continueJobs":
        expect(stored!.status).toBe("completed");
        expect(chainJobs.items).toHaveLength(3);
        expect(chain!.status).toBe("running");
        break;
      case "rescheduleJobs":
        expect(stored!.status).toBe("pending");
        expect(stored!.attemptBy).toBeNull();
        expect(stored!.lastAttemptError).toBe("fenced");
        break;
      case "extendJobAttempt":
        expect(stored!.status).toBe("running");
        expect(stored!.attemptUntil!.getTime()).toBeGreaterThan(job.attemptUntil!.getTime());
        break;
    }
  },
});

const expireAndReclaim = async (
  stateAdapter: StateAdapter<any, any>,
  job: StateJob,
  typeName: string,
  expect: Expect,
): Promise<void> => {
  const extended = await stateAdapter.extendJobAttempt({
    jobId: job.id,
    fence: { attempt: job.attempt, workerId: WORKER_ID },
    timeoutMs: 1,
  });
  expect(extended).toBeDefined();
  await sleep(10);
  const reclaimed = await stateAdapter.reclaimExpiredJobAttempt({
    typeNames: [typeName],
    lastAttemptError: "JobAttemptExpiredError: test",
  });
  expect(reclaimed!.id).toBe(job.id);
};

const methods: FencedMethod[] = [
  "completeJobs",
  "continueJobs",
  "rescheduleJobs",
  "extendJobAttempt",
];
const misses: FenceMiss[] = ["wrong attempt", "wrong worker", "completed", "missing"];

export const attemptFenceGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "attempt fence",
  cases: [
    ...methods.map(fenceMatchCase),
    ...methods.flatMap((method) => misses.map((miss) => fenceMissCase(method, miss))),
    ...methods.map((method): ConformanceCase<StateConformanceFixture> => ({
      name: `${method} fenced on a previous attempt misses after the same worker re-acquires the job`,
      run: async ({ stateAdapter }, expect) => {
        const typeName = `fence-reacquire-${method}`;
        const first = await setupRunningJob(stateAdapter, typeName);
        await expireAndReclaim(stateAdapter, first, typeName, expect);

        const second = await stateAdapter.startJobAttempt({
          workerId: WORKER_ID,
          timeoutMsByTypeName: { [typeName]: 30_000 },
        });
        expect(second!.id).toBe(first.id);
        expect(second!.attempt).toBe(first.attempt + 1);
        expect(second!.attemptBy).toBe(WORKER_ID);

        const before = await snapshot(stateAdapter, first);
        const stale = await runFenced(
          stateAdapter,
          method,
          first.id,
          { attempt: first.attempt, workerId: WORKER_ID },
          typeName,
        );
        expect(stale).toBeUndefined();
        expect(await snapshot(stateAdapter, first)).toEqual(before);

        const current = await runFenced(
          stateAdapter,
          method,
          first.id,
          { attempt: second!.attempt, workerId: WORKER_ID },
          typeName,
        );
        expect(current).toBeDefined();
      },
    })),
  ],
};
