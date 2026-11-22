import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mysql2/promise";
import { it as baseIt, describe, expect } from "vitest";

import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import {
  type Mysql2PoolContext,
  createMysql2PoolProvider,
} from "../state-provider/state-provider.mysql2-pool.ts";

const { connectionOptions } = await acquireMysql("mysql:8.4", import.meta.url);

// oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
const it = baseIt.extend("stateProvider", { scope: "file" }, async ({}, { onCleanup }) => {
  const pool = createPool({ ...connectionOptions, connectionLimit: 5 });
  onCleanup(async () => pool.end());
  const stateProvider = createMysql2PoolProvider({ pool });
  await createMysqlStateAdapter({ stateProvider, dialect: "mysql" }).migrateToLatest();
  return stateProvider;
});

describe("transaction conflict retries", () => {
  it("withTransaction calls the callback again after a deadlock", async ({ stateProvider }) => {
    const stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
    let tries = 0;

    const result = await stateAdapter.withTransaction(async () => {
      tries++;
      if (tries < 5) throw Object.assign(new Error("deadlock"), { errno: 1213 });
      return "committed";
    });

    expect(result).toBe("committed");
    expect(tries).toBe(5);
  });

  it("withTransaction throws the deadlock of the fifth try", async ({ stateProvider }) => {
    const stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
    let tries = 0;

    await expect(
      stateAdapter.withTransaction(async () => {
        tries++;
        throw Object.assign(new Error("deadlock"), { errno: 1213 });
      }),
    ).rejects.toMatchObject({ errno: 1213 });
    expect(tries).toBe(5);
  });

  it("withTransaction calls the callback again after a snapshot conflict", async ({
    stateProvider,
  }) => {
    const stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
    let tries = 0;

    const result = await stateAdapter.withTransaction(async () => {
      tries++;
      if (tries < 2) throw Object.assign(new Error("record has changed"), { errno: 1020 });
      return "committed";
    });

    expect(result).toBe("committed");
    expect(tries).toBe(2);
  });

  it("withTransaction does not call the callback again after another error", async ({
    stateProvider,
  }) => {
    const stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
    let tries = 0;

    await expect(
      stateAdapter.withTransaction(async () => {
        tries++;
        throw Object.assign(new Error("duplicate entry"), { errno: 1062 });
      }),
    ).rejects.toMatchObject({ errno: 1062 });
    expect(tries).toBe(1);
  });

  it("re-executes a statement run without a transaction after a deadlock", async ({
    stateProvider,
  }) => {
    let executions = 0;
    const stateAdapter = createMysqlStateAdapter({
      dialect: "mysql",
      stateProvider: {
        ...stateProvider,
        executeSql: async (options) => {
          executions++;
          if (executions < 5) throw Object.assign(new Error("deadlock"), { errno: 1213 });
          return stateProvider.executeSql(options);
        },
      },
    });

    expect(await stateAdapter.getStartAttemptDelayMs({ typeNames: ["retried"] })).toBeNull();
    expect(executions).toBe(5);
  });

  it("throws the deadlock of the fifth execution of a statement", async ({ stateProvider }) => {
    let executions = 0;
    const stateAdapter = createMysqlStateAdapter({
      dialect: "mysql",
      stateProvider: {
        ...stateProvider,
        executeSql: async () => {
          executions++;
          throw Object.assign(new Error("deadlock"), { errno: 1213 });
        },
      },
    });

    await expect(
      stateAdapter.getStartAttemptDelayMs({ typeNames: ["retried"] }),
    ).rejects.toMatchObject({ errno: 1213 });
    expect(executions).toBe(5);
  });

  it("does not re-execute a statement run in the caller's transaction", async ({
    stateProvider,
  }) => {
    let executions = 0;
    const stateAdapter = createMysqlStateAdapter({
      dialect: "mysql",
      stateProvider: {
        ...stateProvider,
        executeSql: async (options) => {
          if (options.txCtx === undefined) return stateProvider.executeSql(options);
          executions++;
          throw Object.assign(new Error("deadlock"), { errno: 1213 });
        },
      },
    });

    await expect(
      stateProvider.withTransaction(async (txCtx) =>
        stateAdapter.getStartAttemptDelayMs({ txCtx, typeNames: ["retried"] }),
      ),
    ).rejects.toMatchObject({ errno: 1213 });
    expect(executions).toBe(1);
  });

  it("retries a transaction the adapter opens itself as a whole", async ({ stateProvider }) => {
    let failed = false;
    const stateAdapter = createMysqlStateAdapter<Mysql2PoolContext, string, string>({
      dialect: "mysql",
      stateProvider: {
        ...stateProvider,
        executeSql: async (options) => {
          if (
            options.txCtx !== undefined &&
            options.sql.includes("FOR UPDATE SKIP LOCKED") &&
            !failed
          ) {
            failed = true;
            throw Object.assign(new Error("deadlock"), { errno: 1213 });
          }
          return stateProvider.executeSql(options);
        },
      },
    });
    const worker = await stateAdapter.startWorker({
      workerId: crypto.randomUUID(),
      typeNames: ["retried-acquisition"],
      concurrency: 1,
      leaseMs: 60_000,
    });
    const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [{ id: crypto.randomUUID(), typeName: "retried-acquisition", input: null }],
      }),
    );

    const acquired = await stateAdapter.startJobAttempts({
      batchLimits: { "retried-acquisition": 1 },
      workerId: worker.id,
      workerToken: worker.token,
      limit: 1,
    });

    expect(failed).toBe(true);
    expect(acquired.map((job) => job.id)).toEqual([chain.head.id]);
  });

  it("tries up to transactionRetry.maxTries times", async ({ stateProvider }) => {
    const stateAdapter = createMysqlStateAdapter({
      stateProvider,
      dialect: "mysql",
      transactionRetry: { maxTries: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });
    let tries = 0;

    await expect(
      stateAdapter.withTransaction(async () => {
        tries++;
        throw Object.assign(new Error("deadlock"), { errno: 1213 });
      }),
    ).rejects.toMatchObject({ errno: 1213 });
    expect(tries).toBe(2);
  });

  it("rejects a transactionRetry that is not a valid retry config", ({ stateProvider }) => {
    expect(() =>
      createMysqlStateAdapter({
        stateProvider,
        dialect: "mysql",
        transactionRetry: { maxTries: 0, initialDelayMs: -1, maxDelayMs: 50 },
      }),
    ).toThrow(
      "createMysqlStateAdapter: invalid configuration:\n  - transactionRetry.maxTries must be a positive integer (got 0)\n  - transactionRetry.initialDelayMs must be a non-negative finite number (got -1)",
    );
  });
});
