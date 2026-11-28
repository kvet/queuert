import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { SchemaFencedError, type StateAdapter, type StateJobInfo } from "queuert-schema-v1";

import { type Check, type ReadJobs, createFailures } from "./verify.ts";

type LegacyStateAdapter = StateAdapter<any, string, string, "async">;

export type WriterOp = {
  kind: string;
  start: number;
  end: number;
  outcome: "ok" | "fenced" | "error";
};

type TrackedJob = {
  chainId: string;
  status: string;
  attempt: number;
  output: unknown;
  lastAttemptError: string | null;
  continuedToId: string | null;
  deleted: boolean;
};

const writerTypeNames = ["writer:blocker", "writer:dependent", "writer:step"];
const stepChainLength = 5;

/**
 * Schema v1 producers and workers writing through the schema v1 state adapter while 002 runs:
 * each producer transaction creates a blocker chain, a step chain and a dependent blocked by the
 * blocker (every other one also by a seeded gate chain that never completes); workers claim them,
 * continue step chains, reschedule a fifth of first attempts with an error, complete the rest and
 * unblock their dependents; a deleter deletes completed dependent chains. Every committed result is
 * tracked, so the migrated rows can be compared with what they wrote.
 */
export const startWriters = async ({
  stateAdapter,
  gateChainIds,
  producers,
  workers,
}: {
  stateAdapter: LegacyStateAdapter;
  gateChainIds: string[];
  producers: number;
  workers: number;
}) => {
  const worker = await stateAdapter.startWorker({
    workerId: randomUUID(),
    typeNames: writerTypeNames,
    concurrency: 1000,
    leaseMs: 3_600_000,
  });
  const jobs = new Map<string, TrackedJob>();
  const chainStatuses = new Map<string, string>();
  const blockerRows = new Map<string, string[]>();
  const gatedJobIds = new Set<string>();
  const deletableChainIds: string[] = [];
  const ops: WriterOp[] = [];
  const errors: string[] = [];
  const lifecycle = { stopping: false };

  const track = (job: StateJobInfo) => {
    const previous = jobs.get(job.id);
    jobs.set(job.id, {
      chainId: job.chainId,
      status: job.status,
      attempt: job.attempt,
      output: job.output,
      lastAttemptError: job.lastAttemptError,
      continuedToId: job.continuedToId,
      deleted: previous?.deleted ?? false,
    });
  };

  const timed = async <T>(kind: string, run: () => Promise<T>): Promise<T | undefined> => {
    const start = performance.now();
    try {
      const result = await run();
      ops.push({ kind, start, end: performance.now(), outcome: "ok" });
      return result;
    } catch (error) {
      const fenced = error instanceof SchemaFencedError;
      ops.push({ kind, start, end: performance.now(), outcome: fenced ? "fenced" : "error" });
      if (!fenced) errors.push(`${kind}: ${String(error)}`);
      return undefined;
    }
  };

  const fenced = () => ops.some(({ outcome }) => outcome === "fenced");

  const produce = async (loop: number) => {
    for (let index = 0; !lifecycle.stopping && !fenced(); index++) {
      const gated = (loop + index) % 2 === 0;
      const created = await timed("create", async () =>
        stateAdapter.withTransaction(async (txCtx) => {
          const [blocker, dependent, step] = await stateAdapter.createJobs({
            txCtx,
            jobs: writerTypeNames.map((typeName) => ({
              id: stateAdapter.config.generateJobId(),
              typeName,
              input: { loop, index },
            })),
          });
          const blockedByChainIds = gated
            ? [blocker.id, gateChainIds[index % gateChainIds.length]]
            : [blocker.id];
          const [blocked] = await stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: dependent.head.id, blockedByChainIds }],
          });
          return { heads: [blocker.head, blocked, step.head], blockedByChainIds };
        }),
      );
      if (created === undefined) continue;
      for (const head of created.heads) {
        track(head);
        chainStatuses.set(head.chainId, "running");
      }
      blockerRows.set(created.heads[1].id, created.blockedByChainIds);
      if (gated) gatedJobIds.add(created.heads[1].id);
    }
  };

  const complete = async (job: StateJobInfo) => {
    const completed = await timed("complete", async () =>
      stateAdapter.withTransaction(async (txCtx) => {
        const [done] = await stateAdapter.completeJobs({
          txCtx,
          jobs: [
            {
              jobId: job.id,
              output: { ok: true, attempt: job.attempt },
              attemptToken: job.attemptToken!,
              workerId: worker.id,
            },
          ],
        });
        const dependents = await stateAdapter.unblockJobs({ txCtx, blockedByChainId: job.chainId });
        return { done: done!, dependents };
      }),
    );
    if (completed === undefined) return;
    track(completed.done);
    chainStatuses.set(completed.done.chainId, completed.done.chain.status);
    for (const { job: dependent } of completed.dependents) track(dependent);
    if (job.typeName === "writer:dependent" && !gatedJobIds.has(job.id)) {
      deletableChainIds.push(job.chainId);
    }
  };

  const process = async (job: StateJobInfo) => {
    if (job.typeName === "writer:step" && job.chainIndex < stepChainLength - 1) {
      const continued = await timed("continue", async () =>
        stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "writer:step",
                input: { index: job.chainIndex + 1 },
                continueFromId: job.id,
                attemptToken: job.attemptToken!,
                workerId: worker.id,
              },
            ],
          }),
        ),
      );
      if (continued?.[0] === undefined) return;
      track(continued[0]);
      track(continued[0].continuation);
      return;
    }
    if (job.attempt === 1 && parseInt(job.id.slice(-2), 16) % 5 === 0) {
      const rescheduled = await timed("reschedule", async () =>
        stateAdapter.rescheduleJobs({
          jobs: [
            {
              jobId: job.id,
              schedule: { afterMs: 0 },
              error: "Error: writer transient failure",
              attemptToken: job.attemptToken!,
            },
          ],
        }),
      );
      if (rescheduled?.[0] !== undefined) track(rescheduled[0]);
      return;
    }
    await complete(job);
  };

  const work = async () => {
    while (!lifecycle.stopping && !fenced()) {
      const claimed = await timed("claim", async () =>
        stateAdapter.startJobAttempts({
          typeNames: writerTypeNames,
          workerId: worker.id,
          workerToken: worker.token,
          limit: 10,
        }),
      );
      if (claimed === undefined) continue;
      if (claimed.length === 0) {
        await sleep(5);
        continue;
      }
      for (const job of claimed) track(job);
      for (const job of claimed) await process(job);
    }
  };

  const remove = async () => {
    while (!lifecycle.stopping && !fenced()) {
      const chainId = deletableChainIds.shift();
      if (chainId === undefined) {
        await sleep(10);
        continue;
      }
      const deleted = await timed("delete", async () =>
        stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getChains({ txCtx, chainIds: [chainId], lock: "exclusive" });
          return stateAdapter.deleteChains({ txCtx, chainIds: [chainId] });
        }),
      );
      if (deleted === undefined) {
        deletableChainIds.unshift(chainId);
        continue;
      }
      jobs.get(chainId)!.deleted = true;
      blockerRows.delete(chainId);
    }
  };

  const loops = Promise.all([
    ...Array.from({ length: producers }, async (_, loop) => produce(loop)),
    ...Array.from({ length: workers }, async () => work()),
    remove(),
  ]);

  return {
    ops,
    errors,
    stop: async () => {
      lifecycle.stopping = true;
      await loops;
    },
    expectedJobCount: () => [...jobs.values()].filter(({ deleted }) => !deleted).length,
    expectedBlockerRowCount: () =>
      [...blockerRows.values()].reduce((sum, chainIds) => sum + chainIds.length, 0),
    /** Every job the schema v1 writers wrote must read back through the current adapter as it was last committed. */
    verifyReadback: async (readJobs: ReadJobs): Promise<Check[]> => {
      const { compared, fail, checks } = createFailures();
      const blockingChainIds = new Set([...blockerRows.values()].flat());
      const entries = [...jobs];
      for (let start = 0; start < entries.length; start += 500) {
        const batch = entries.slice(start, start + 500);
        const actualJobs = await readJobs(batch.map(([id]) => id));
        for (const [index, [id, expected]] of batch.entries()) {
          const actual = actualJobs[index];
          if (expected.deleted) {
            if (actual !== undefined) fail("deleted job present", id, actual.status, undefined);
            continue;
          }
          if (actual === undefined) {
            fail("written job missing", id, undefined, expected.status);
            continue;
          }
          const compare = (field: string, actualValue: unknown, expectedValue: unknown) => {
            compared();
            if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
              fail(`written ${field}`, id, actualValue, expectedValue);
            }
          };
          compare("status", actual.status, expected.status);
          compare("attempt", actual.attempt, expected.attempt);
          compare("output", actual.output, expected.output);
          compare("lastAttemptError", actual.lastAttemptError, expected.lastAttemptError);
          compare(
            "consecutiveFailures",
            actual.consecutiveFailures,
            expected.lastAttemptError === null ? 0 : 1,
          );
          compare("continuedToId", actual.continuedToId, expected.continuedToId);
          compare("chain.status", actual.chain.status, chainStatuses.get(expected.chainId));
          compare("chain.blocking", actual.chain.blocking, blockingChainIds.has(expected.chainId));
        }
      }
      return checks();
    },
  };
};

export type Writers = Awaited<ReturnType<typeof startWriters>>;

const percentile = (values: number[], fraction: number) =>
  values.length === 0
    ? Number.NaN
    : values.toSorted((a, b) => a - b)[
        Math.min(values.length - 1, Math.floor(values.length * fraction))
      ];

/** Throughput and latency of the writes that started inside `[from, to)`. */
export const writeStats = (ops: WriterOp[], from: number, to: number) => {
  const window = ops.filter(
    ({ start, outcome }) => start >= from && start < to && outcome === "ok",
  );
  const latencies = window.map(({ start, end }) => end - start);
  return {
    opsPerSecond: (window.length / (to - from)) * 1000,
    p50: percentile(latencies, 0.5),
    p99: percentile(latencies, 0.99),
  };
};

/** The longest a write that started before `fenceAt` waited, whatever its outcome. */
export const longestStall = (ops: WriterOp[], from: number, fenceAt: number) =>
  ops
    .filter(({ start }) => start >= from && start < fenceAt)
    .reduce((longest, { start, end }) => Math.max(longest, end - start), 0);
