// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { randomUUID } from "node:crypto";

import { sleep } from "@queuert/helpers/sleep";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { it as baseIt, describe, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";
import {
  type PgIsolationLevel,
  pgIsolationPoolOptions,
} from "./state-adapter-conformance.spec-helper.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

const levels: PgIsolationLevel[] = ["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"];

const it = baseIt.extend("adapters", { scope: "file" }, async ({}, { onCleanup }) => {
  const pools = levels.map(
    (level) =>
      new Pool({
        connectionString: pg.connectionString,
        idleTimeoutMillis: 0,
        max: 6,
        ...pgIsolationPoolOptions(level),
      }),
  );
  onCleanup(async () => {
    await Promise.all(pools.map(async (pool) => pool.end()));
  });
  const adapters = new Map(
    levels.map((level, index) => [
      level,
      createPgStateAdapter<PgPoolContext, string, string>({
        stateProvider: createPgPoolProvider({ pool: pools[index] }),
      }),
    ]),
  );
  await adapters.get("READ COMMITTED")!.migrateToLatest();
  return adapters;
});

// NOTE: hack for vitest plugin
baseIt("index");

describe("blocker races across isolation levels", () => {
  for (const firstLevel of levels) {
    for (const secondLevel of levels) {
      it(`attach waiting on a completion (${firstLevel} completer, ${secondLevel} attacher) leaves the dependent pending`, async ({
        adapters,
      }) => {
        const completer = adapters.get(firstLevel)!;
        const attacher = adapters.get(secondLevel)!;
        const blockerId = randomUUID();
        const dependentId = randomUUID();
        await completer.withTransaction(async (txCtx) =>
          completer.createJobs({
            txCtx,
            jobs: [
              { typeName: "race-blocker", id: blockerId, input: null },
              { typeName: "race-dependent", id: dependentId, input: null },
            ],
          }),
        );
        const completed = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const completion = completer.withTransaction(async (txCtx) => {
          await completer.getJobs({ txCtx, jobIds: [dependentId] });
          const [job] = await completer.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerId, output: null }],
          });
          if (job!.hasDependents) {
            await completer.unblockJobs({ txCtx, blockedByChainId: blockerId });
          }
          completed.resolve();
          await release.promise;
        });
        await completed.promise;
        const attach = attacher.withTransaction(async (txCtx) => {
          await attacher.getJobs({ txCtx, jobIds: [dependentId] });
          await attacher.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: dependentId, blockedByChainIds: [blockerId] }],
          });
        });
        await sleep(200);
        release.resolve();
        await Promise.all([completion, attach]);

        const [dependent] = await completer.getJobs({ jobIds: [dependentId] });
        expect(dependent!.status).toBe("pending");
      });

      it(`completion waiting on an attach (${firstLevel} attacher, ${secondLevel} completer) leaves the dependent pending`, async ({
        adapters,
      }) => {
        const attacher = adapters.get(firstLevel)!;
        const completer = adapters.get(secondLevel)!;
        const blockerId = randomUUID();
        const dependentId = randomUUID();
        await attacher.withTransaction(async (txCtx) =>
          attacher.createJobs({
            txCtx,
            jobs: [
              { typeName: "race-blocker", id: blockerId, input: null },
              { typeName: "race-dependent", id: dependentId, input: null },
            ],
          }),
        );
        const attached = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const attach = attacher.withTransaction(async (txCtx) => {
          await attacher.getJobs({ txCtx, jobIds: [dependentId] });
          await attacher.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: dependentId, blockedByChainIds: [blockerId] }],
          });
          attached.resolve();
          await release.promise;
        });
        await attached.promise;
        const completion = completer.withTransaction(async (txCtx) => {
          await completer.getJobs({ txCtx, jobIds: [dependentId] });
          const [job] = await completer.completeJobs({
            txCtx,
            jobs: [{ jobId: blockerId, output: null }],
          });
          if (job!.hasDependents) {
            await completer.unblockJobs({ txCtx, blockedByChainId: blockerId });
          }
        });
        await sleep(200);
        release.resolve();
        await Promise.all([attach, completion]);

        const [dependent] = await completer.getJobs({ jobIds: [dependentId] });
        expect(dependent!.status).toBe("pending");
      });

      it(`two blockers of one dependent completing concurrently (${firstLevel} first, ${secondLevel} second) leave the dependent pending`, async ({
        adapters,
      }) => {
        const first = adapters.get(firstLevel)!;
        const second = adapters.get(secondLevel)!;
        const blockerIds = [randomUUID(), randomUUID()];
        const dependentId = randomUUID();
        await first.withTransaction(async (txCtx) => {
          await first.createJobs({
            txCtx,
            jobs: [
              ...blockerIds.map((id) => ({ typeName: "race-blocker", id, input: null })),
              { typeName: "race-dependent", id: dependentId, input: null },
            ],
          });
          await first.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: dependentId, blockedByChainIds: blockerIds }],
          });
        });
        const completed = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const complete = async (
          adapter: typeof first,
          blockerId: string,
          hold: boolean,
        ): Promise<void> =>
          adapter.withTransaction(async (txCtx) => {
            await adapter.getJobs({ txCtx, jobIds: [dependentId] });
            const [job] = await adapter.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerId, output: null }],
            });
            if (job!.hasDependents) {
              await adapter.unblockJobs({ txCtx, blockedByChainId: blockerId });
            }
            if (hold) {
              completed.resolve();
              await release.promise;
            }
          });
        const firstCompletion = complete(first, blockerIds[0], true);
        await completed.promise;
        const secondCompletion = complete(second, blockerIds[1], false);
        await sleep(200);
        release.resolve();
        await Promise.all([firstCompletion, secondCompletion]);

        const [dependent] = await first.getJobs({ jobIds: [dependentId] });
        expect(dependent!.status).toBe("pending");
      });

      it(`a reclaim racing a claim of the same worker (${firstLevel} claim, ${secondLevel} reclaim) never orphans the job`, async ({
        adapters,
      }) => {
        const claimer = adapters.get(firstLevel)!;
        const reclaimer = adapters.get(secondLevel)!;
        const typeName = `race-claim-${randomUUID()}`;
        const worker = await claimer.startWorker({
          workerId: randomUUID(),
          typeNames: [typeName],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [chain] = await claimer.withTransaction(async (txCtx) =>
          claimer.createJobs({ txCtx, jobs: [{ typeName, id: randomUUID(), input: null }] }),
        );
        const claimed = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const claim = claimer.withTransaction(async (txCtx) => {
          const jobs = await claimer.startJobAttempts({
            txCtx,
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: [typeName],
            limit: 1,
          });
          claimed.resolve();
          await release.promise;
          return jobs;
        });
        await claimed.promise;
        const reclaim = reclaimer.withTransaction(async (txCtx) => {
          await reclaimer.getWorkers({ txCtx, workerIds: [worker.id], lock: "exclusive" });
          const { items } = await reclaimer.listWorkerJobs({
            txCtx,
            workerId: worker.id,
            orderDirection: "asc",
            page: { limit: 10 },
          });
          await reclaimer.stopWorker({ txCtx, workerId: worker.id, workerToken: worker.token });
          return items;
        });
        await sleep(200);
        release.resolve();
        const claimedIds = (await claim.catch(() => [])).map((job) => job.id);
        const reclaimedIds = (await reclaim).map((job) => job.id);

        const [stored] = await claimer.getJobs({ jobIds: [chain.head.id] });
        if (claimedIds.includes(chain.head.id)) {
          expect(reclaimedIds).toEqual([chain.head.id]);
        } else {
          expect(stored!.status).toBe("pending");
        }
      });
    }
  }
});
