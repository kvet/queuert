import Database from "better-sqlite3";
import { it as baseIt, describe, expect } from "vitest";

import {
  type SqliteStateAdapter,
  createSqliteStateAdapter,
} from "../state-adapter/state-adapter.sqlite.js";
import {
  type BetterSqlite3Context,
  createBetterSqlite3Provider,
} from "../state-provider/state-provider.better-sqlite3.js";

const it = baseIt.extend<{
  db: Database.Database;
  executed: { sql: string; params: unknown[] }[];
  adapter: SqliteStateAdapter<BetterSqlite3Context, string>;
}>({
  // oxlint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const db = new Database(":memory:");
    await use(db);
    db.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  executed: async ({}, use) => {
    await use([]);
  },
  adapter: async ({ db, executed }, use) => {
    const provider = createBetterSqlite3Provider({ db });
    const adapter = await createSqliteStateAdapter<BetterSqlite3Context, string>({
      stateProvider: {
        ...provider,
        executeSql: async (options) => {
          executed.push({ sql: options.sql, params: options.params });
          return provider.executeSql(options);
        },
      },
    });
    await adapter.migrateToLatest();
    await use(adapter);
  },
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
        jobs: [{ typeName: "t", input: null, deduplication: { key: "k", scope: "running" } }],
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
      "SEARCH queuert_job USING INDEX queuert_chain_deduplication_idx (chain_deduplication_key=?)",
    ]);
  });
});

describe("addJobsBlockers", () => {
  it("writes no blocker row for an id that is not a chain head", async ({ db, adapter }) => {
    const [mainChain, blockerChain] = await adapter.withTransaction(async (txCtx) =>
      adapter.createJobs({
        txCtx,
        jobs: [
          { typeName: "main", input: null },
          { typeName: "blocker", input: null },
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
