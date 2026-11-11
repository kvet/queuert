import Database from "better-sqlite3";
import { it as baseIt, describe, expect } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.ts";

const it = baseIt
  // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
  .extend("db", async ({}, { onCleanup }) => {
    const db = new Database(":memory:");
    onCleanup(async () => {
      db.close();
    });
    return db;
  })
  .extend("executed", async (): Promise<{ sql: string; params: unknown[] }[]> => [])
  .extend("adapter", async ({ db, executed }) => {
    const provider = createBetterSqlite3Provider({ db });
    const adapter = createSqliteStateAdapter<BetterSqlite3Context, string>({
      stateProvider: {
        ...provider,
        executeSql: async (options) => {
          executed.push({ sql: options.sql, params: options.params });
          return provider.executeSql(options);
        },
      },
    });
    await adapter.migrateToLatest();
    return adapter;
  });

// TODO: should be a part of conformance tests
describe("deduplication lookup", () => {
  it("searches chain_deduplication_idx on a database without statistics", async ({
    db,
    executed,
    adapter,
  }) => {
    await adapter.withTransaction(async (txCtx) =>
      adapter.createJobs({
        txCtx,
        jobs: [
          {
            id: adapter.config.generateJobId(),
            typeName: "t",
            input: null,
            deduplication: { key: "k", scope: "running" },
          },
        ],
      }),
    );

    expect(
      db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE name = 'sqlite_stat1'").get(),
    ).toEqual({ c: 0 });
    const lookup = executed.find(({ sql }) => sql.includes("chain_deduplication_key = ?"));
    expect(lookup).toBeDefined();
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${lookup!.sql}`).all(...lookup!.params) as {
      detail: string;
    }[];
    expect(plan.map((row) => row.detail)).toEqual([
      "SEARCH head_job USING INDEX queuert_chain_deduplication_idx (chain_deduplication_key=?)",
      "SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN",
      "CORRELATED SCALAR SUBQUERY 1",
      "SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)",
    ]);
  });
});

describe("addJobsBlockers", () => {
  it("writes no blocker row for an id that is not a chain head", async ({ db, adapter }) => {
    const [mainChain, blockerChain] = await adapter.withTransaction(async (txCtx) =>
      adapter.createJobs({
        txCtx,
        jobs: [
          { id: adapter.config.generateJobId(), typeName: "main", input: null },
          { id: adapter.config.generateJobId(), typeName: "blocker", input: null },
        ],
      }),
    );

    await expect(
      adapter.withTransaction(async (txCtx) => {
        const [result] = await adapter.addJobsBlockers({
          txCtx,
          jobBlockers: [
            { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id, "missing-chain"] },
          ],
        });
        expect(result.blockers.map((blocker) => blocker?.id)).toEqual([blockerChain.id, undefined]);
        expect(result.status).toBe("blocked");
        expect(db.prepare("SELECT blocked_by_chain_id FROM queuert_job_blocker").all()).toEqual([
          { blocked_by_chain_id: blockerChain.id },
        ]);
        throw new Error("caller aborts");
      }),
    ).rejects.toThrow("caller aborts");
  });
});
