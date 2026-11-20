// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { randomUUID } from "node:crypto";

import { raceWithSleep } from "@queuert/helpers/sleep";
import { acquireMysql } from "@queuert/testcontainers";
import { withTxHooks } from "queuert";
import { it as baseIt, describe, expect } from "vitest";

import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import { createMysql2PoolAtLevel } from "../state-provider/state-provider.mysql2-pool.spec-helper.ts";
import {
  type Mysql2PoolContext,
  classifyMysqlError,
  createMysql2PoolProvider,
} from "../state-provider/state-provider.mysql2-pool.ts";

type Level = "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";

const servers = [
  { image: "mysql:8.4", dialect: "mysql", snapshotIsolation: undefined },
  { image: "mariadb:11.4", dialect: "mariadb", snapshotIsolation: undefined },
  { image: "mariadb:11.8", dialect: "mariadb", snapshotIsolation: true },
  { image: "mariadb:11.8", dialect: "mariadb", snapshotIsolation: false },
] as const;

const suites = await Promise.all(
  servers.map(async (server) => {
    const label = `${server.image}${server.snapshotIsolation === undefined ? "" : `, innodb_snapshot_isolation ${server.snapshotIsolation ? "ON" : "OFF"}`}`;
    const { connectionOptions } = await acquireMysql(server.image, `${import.meta.url}-${label}`);
    const it = baseIt.extend("database", { scope: "file" }, async ({}, { onCleanup }) => {
      const pool = createMysql2PoolAtLevel(
        { ...connectionOptions, connectionLimit: 6 },
        "READ COMMITTED",
        server.snapshotIsolation,
      );
      onCleanup(async () => pool.end());
      const stateAdapter = createMysqlStateAdapter<Mysql2PoolContext, string, string>({
        stateProvider: createMysql2PoolProvider({ pool }),
        dialect: server.dialect,
      });
      await stateAdapter.migrateToLatest();
      const inTransaction = async <T>(
        level: Level,
        fn: (txCtx: Mysql2PoolContext) => Promise<T>,
      ): Promise<T> =>
        withTxHooks(async (txHooks) => {
          const connection = await pool.getConnection();
          try {
            await connection.query(`SET TRANSACTION ISOLATION LEVEL ${level}`);
            await connection.query("START TRANSACTION");
            const result = await fn({ connection, txHooks });
            await connection.query("COMMIT");
            return result;
          } catch (error) {
            await connection.query("ROLLBACK");
            throw error;
          } finally {
            connection.release();
          }
        });
      return { stateAdapter, inTransaction };
    });
    return { label, snapshotIsolation: server.snapshotIsolation, it };
  }),
);

// NOTE: hack for vitest plugin
baseIt("index");

for (const { label, snapshotIsolation, it } of suites) {
  describe.each([
    ["READ COMMITTED", "REPEATABLE READ"],
    ["READ COMMITTED", "SERIALIZABLE"],
    ["SERIALIZABLE", "REPEATABLE READ"],
    ["REPEATABLE READ", "REPEATABLE READ"],
  ] as const)(`${label}: holder at %s, waiter at %s`, (holderLevel, waiterLevel) => {
    const runWhileHeld = async <THolder, TWaiter>(
      holder: (held: () => Promise<void>) => Promise<THolder>,
      waiter: () => Promise<TWaiter>,
    ): Promise<{ held: THolder; waited: TWaiter }> => {
      const holding = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const holderResult = holder(async () => {
        holding.resolve();
        await release.promise;
      });
      await holding.promise;
      const waiterResult = waiter();
      expect(
        await raceWithSleep(
          waiterResult.then(
            () => "settled",
            () => "settled",
          ),
          100,
        ),
      ).toBeUndefined();
      release.resolve();
      const held = await holderResult;
      const waited = await waiterResult.catch(async (error: unknown) => {
        if (
          snapshotIsolation === true &&
          classifyMysqlError({ error })?.kind === "transaction_conflict"
        ) {
          return waiter();
        }
        throw error;
      });
      return { held, waited };
    };

    const orSnapshotConflict = async <T>(run: () => Promise<T>): Promise<T | "conflict"> =>
      run().catch((error: unknown) => {
        if (
          snapshotIsolation === true &&
          classifyMysqlError({ error })?.kind === "transaction_conflict"
        ) {
          return "conflict" as const;
        }
        throw error;
      });

    it("a chain lock on a chain created after the transaction's snapshot returns its head", async ({
      database: { stateAdapter, inTransaction },
    }) => {
      const locked = await orSnapshotConflict(async () =>
        inTransaction(waiterLevel, async (txCtx) => {
          await stateAdapter.getWorkers({ txCtx, workerIds: [randomUUID()] });
          const [chain] = await stateAdapter.withTransaction(async (ownTxCtx) =>
            stateAdapter.createJobs({
              txCtx: ownTxCtx,
              jobs: [{ id: randomUUID(), typeName: "late-chain", input: null }],
            }),
          );
          const [lockedChain] = await stateAdapter.getChains({
            txCtx,
            chainIds: [chain.id],
            lock: "exclusive",
          });
          return [chain.id, lockedChain] as const;
        }),
      );
      if (locked === "conflict") return;

      expect(locked[1]?.id).toBe(locked[0]);
      expect(locked[1]?.status).toBe("running");
    });

    it("a deletion clears the blocking flag of a chain blocking a continuation added after the transaction's snapshot", async ({
      database: { stateAdapter, inTransaction },
    }) => {
      const [deletedChain, blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: ["deleted", "blocker"].map((typeName) => ({
            id: randomUUID(),
            typeName,
            input: null,
          })),
        }),
      );

      const deleted = await orSnapshotConflict(async () =>
        inTransaction(waiterLevel, async (txCtx) => {
          await stateAdapter.getWorkers({ txCtx, workerIds: [randomUUID()] });
          await stateAdapter.withTransaction(async (ownTxCtx) => {
            const [continued] = await stateAdapter.continueJobs({
              txCtx: ownTxCtx,
              jobs: [
                {
                  id: randomUUID(),
                  typeName: "deleted-next",
                  input: null,
                  continueFromId: deletedChain.head.id,
                },
              ],
            });
            await stateAdapter.addJobsBlockers({
              txCtx: ownTxCtx,
              jobBlockers: [
                { jobId: continued!.continuation.id, blockedByChainIds: [blockerChain.id] },
              ],
            });
          });
          await stateAdapter.deleteChains({ txCtx, chainIds: [deletedChain.id] });
        }),
      );
      if (deleted === "conflict") return;

      const [blocker] = await stateAdapter.getChains({ chainIds: [blockerChain.id] });
      expect(blocker!.blocking).toBe(false);
    });

    it("a deletion of a dependent waiting on an attach to its blocker keeps the blocker blocking", async ({
      database: { stateAdapter, inTransaction },
    }) => {
      const [blockerChain, deletedChain, attachedChain] = await stateAdapter.withTransaction(
        async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: ["blocker", "deleted-dependent", "attached-dependent"].map((typeName) => ({
              id: randomUUID(),
              typeName,
              input: null,
            })),
          }),
      );
      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [{ jobId: deletedChain.head.id, blockedByChainIds: [blockerChain.id] }],
        }),
      );

      await runWhileHeld(
        async (held) =>
          inTransaction(holderLevel, async (txCtx) => {
            await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: attachedChain.head.id, blockedByChainIds: [blockerChain.id] }],
            });
            await held();
          }),
        async () =>
          inTransaction(waiterLevel, async (txCtx) => {
            await stateAdapter.getJobs({ txCtx, jobIds: [randomUUID()] });
            await stateAdapter.deleteChains({ txCtx, chainIds: [deletedChain.id] });
          }),
      );

      const [blocker] = await stateAdapter.getChains({ chainIds: [blockerChain.id] });
      expect(blocker!.blocking).toBe(true);
    });

    it("a completion waiting on an attach to an already blocking chain unblocks the attached dependent", async ({
      database: { stateAdapter, inTransaction },
    }) => {
      const [blockerChain, firstChain, secondChain] = await stateAdapter.withTransaction(
        async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: ["blocker", "first-dependent", "second-dependent"].map((typeName) => ({
              id: randomUUID(),
              typeName,
              input: null,
            })),
          }),
      );
      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [{ jobId: firstChain.head.id, blockedByChainIds: [blockerChain.id] }],
        }),
      );

      await runWhileHeld(
        async (held) =>
          inTransaction(holderLevel, async (txCtx) => {
            await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: secondChain.head.id, blockedByChainIds: [blockerChain.id] }],
            });
            await held();
          }),
        async () =>
          inTransaction(waiterLevel, async (txCtx) => {
            await stateAdapter.getJobs({ txCtx, jobIds: [randomUUID()] });
            const [completed] = await stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerChain.head.id, output: null }],
            });
            if (completed!.chain.blocking) {
              await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerChain.id });
            }
          }),
      );

      const dependents = await stateAdapter.getJobs({
        jobIds: [firstChain.head.id, secondChain.head.id],
      });
      expect(dependents.map((job) => job?.status)).toEqual(["pending", "pending"]);
    });

    it("an attach waiting on the completion of the blocker leaves the dependent pending", async ({
      database: { stateAdapter, inTransaction },
    }) => {
      const [blockerChain, dependentChain] = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: ["blocker", "dependent"].map((typeName) => ({
            id: randomUUID(),
            typeName,
            input: null,
          })),
        }),
      );

      const { waited } = await runWhileHeld(
        async (held) =>
          inTransaction(holderLevel, async (txCtx) => {
            await stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: blockerChain.head.id, output: null }],
            });
            await held();
          }),
        async () =>
          inTransaction(waiterLevel, async (txCtx) => {
            await stateAdapter.getJobs({ txCtx, jobIds: [randomUUID()] });
            return stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: dependentChain.head.id, blockedByChainIds: [blockerChain.id] },
              ],
            });
          }),
      );

      expect(waited.map((job) => [job.status, job.blockers.map((chain) => chain?.status)])).toEqual(
        [["pending", ["completed"]]],
      );
      const [dependent] = await stateAdapter.getJobs({ jobIds: [dependentChain.head.id] });
      expect(dependent!.status).toBe("pending");
    });

    it("two completions of one dependent's blockers leave the dependent pending", async ({
      database: { stateAdapter, inTransaction },
    }) => {
      const [firstBlocker, secondBlocker, dependentChain] = await stateAdapter.withTransaction(
        async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: ["first-blocker", "second-blocker", "dependent"].map((typeName) => ({
              id: randomUUID(),
              typeName,
              input: null,
            })),
          }),
      );
      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [
            {
              jobId: dependentChain.head.id,
              blockedByChainIds: [firstBlocker.id, secondBlocker.id],
            },
          ],
        }),
      );
      const completeBlocker = async (txCtx: Mysql2PoolContext, blockerId: string) => {
        await stateAdapter.completeJobs({ txCtx, jobs: [{ jobId: blockerId, output: null }] });
        await stateAdapter.unblockJobs({ txCtx, blockedByChainId: blockerId });
      };

      await runWhileHeld(
        async (held) =>
          inTransaction(holderLevel, async (txCtx) => {
            await completeBlocker(txCtx, firstBlocker.id);
            await held();
          }),
        async () =>
          inTransaction(waiterLevel, async (txCtx) => {
            await stateAdapter.getJobs({ txCtx, jobIds: [randomUUID()] });
            await completeBlocker(txCtx, secondBlocker.id);
          }),
      );

      const [dependent] = await stateAdapter.getJobs({ jobIds: [dependentChain.head.id] });
      expect(dependent!.status).toBe("pending");
    });

    it("a deletion waiting on an attach to the deleted chain refuses to delete it", async ({
      database: { stateAdapter, inTransaction },
    }) => {
      const [blockerChain, dependentChain] = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: ["blocker", "dependent"].map((typeName) => ({
            id: randomUUID(),
            typeName,
            input: null,
          })),
        }),
      );

      const { waited } = await runWhileHeld(
        async (held) =>
          inTransaction(holderLevel, async (txCtx) => {
            await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: dependentChain.head.id, blockedByChainIds: [blockerChain.id] },
              ],
            });
            await held();
          }),
        async () =>
          inTransaction(waiterLevel, async (txCtx) => {
            await stateAdapter.getJobs({ txCtx, jobIds: [randomUUID()] });
            return stateAdapter.deleteChains({ txCtx, chainIds: [blockerChain.id] });
          }),
      );

      expect(waited).toEqual([
        [expect.objectContaining({ job: expect.objectContaining({ id: dependentChain.head.id }) })],
      ]);
      const [blocker] = await stateAdapter.getChains({ chainIds: [blockerChain.id] });
      expect(blocker!.blocking).toBe(true);
    });

    it("a chain lock waiting on the completion of the chain returns the completed head", async ({
      database: { stateAdapter, inTransaction },
    }) => {
      const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: [{ id: randomUUID(), typeName: "locked-chain", input: null }],
        }),
      );

      const { waited } = await runWhileHeld(
        async (held) =>
          inTransaction(holderLevel, async (txCtx) => {
            await stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: chain.head.id, output: "done" }],
            });
            await held();
          }),
        async () =>
          inTransaction(waiterLevel, async (txCtx) => {
            await stateAdapter.getJobs({ txCtx, jobIds: [randomUUID()] });
            return stateAdapter.getChains({ txCtx, chainIds: [chain.id], lock: "exclusive" });
          }),
      );

      expect(waited.map((locked) => [locked?.status, locked?.head.output])).toEqual([
        ["completed", "done"],
      ]);
    });

    it("a fence waiting on a reclaim of the attempt sees the attempt lost", async ({
      database: { stateAdapter, inTransaction },
    }) => {
      const typeName = `reclaimed-${randomUUID()}`;
      const worker = await stateAdapter.startWorker({
        workerId: randomUUID(),
        typeNames: [typeName],
        concurrency: 1,
        leaseMs: 60_000,
      });
      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: [{ id: randomUUID(), typeName, input: null }],
        }),
      );
      const [attempt] = await stateAdapter.startJobAttempts({
        typeNames: [typeName],
        workerId: worker.id,
        workerToken: worker.token,
        limit: 1,
      });

      const { waited } = await runWhileHeld(
        async (held) =>
          inTransaction(holderLevel, async (txCtx) => {
            await stateAdapter.rescheduleJobs({
              txCtx,
              jobs: [
                {
                  jobId: attempt.id,
                  schedule: { afterMs: 0 },
                  attemptToken: attempt.attemptToken!,
                  error: "reclaimed",
                },
              ],
            });
            await held();
          }),
        async () =>
          inTransaction(waiterLevel, async (txCtx) => {
            await stateAdapter.getJobs({ txCtx, jobIds: [randomUUID()] });
            return stateAdapter.getJobs({ txCtx, jobIds: [attempt.id], lock: "exclusive" });
          }),
      );

      expect(waited.map((job) => [job?.status, job?.attemptToken])).toEqual([["pending", null]]);
    });
  });
}
