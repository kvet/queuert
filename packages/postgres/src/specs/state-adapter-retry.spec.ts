import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { it as baseIt, describe, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import { createPgPoolProvider } from "../state-provider/state-provider.pg-pool.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

// oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
const it = baseIt.extend("stateProvider", { scope: "file" }, async ({}, { onCleanup }) => {
  const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
  onCleanup(async () => pool.end());
  const stateProvider = createPgPoolProvider({ pool });
  await createPgStateAdapter({ stateProvider }).migrateToLatest();
  return stateProvider;
});

describe("transaction conflict retries", () => {
  it("withTransaction calls the callback again after a serialization failure", async ({
    stateProvider,
  }) => {
    const stateAdapter = createPgStateAdapter({ stateProvider });
    let tries = 0;

    const result = await stateAdapter.withTransaction(async () => {
      tries++;
      if (tries < 5) throw Object.assign(new Error("conflict"), { code: "40001" });
      return "committed";
    });

    expect(result).toBe("committed");
    expect(tries).toBe(5);
  });

  it("withTransaction throws the serialization failure of the fifth try", async ({
    stateProvider,
  }) => {
    const stateAdapter = createPgStateAdapter({ stateProvider });
    let tries = 0;

    await expect(
      stateAdapter.withTransaction(async () => {
        tries++;
        throw Object.assign(new Error("conflict"), { code: "40001" });
      }),
    ).rejects.toMatchObject({ code: "40001" });
    expect(tries).toBe(5);
  });

  it("withTransaction does not call the callback again after another error", async ({
    stateProvider,
  }) => {
    const stateAdapter = createPgStateAdapter({ stateProvider });
    let tries = 0;

    await expect(
      stateAdapter.withTransaction(async () => {
        tries++;
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      }),
    ).rejects.toMatchObject({ code: "23505" });
    expect(tries).toBe(1);
  });

  it("withTransaction calls the callback again after a deadlock", async ({ stateProvider }) => {
    const stateAdapter = createPgStateAdapter({ stateProvider });
    let tries = 0;

    const result = await stateAdapter.withTransaction(async () => {
      tries++;
      if (tries < 2) throw Object.assign(new Error("deadlock"), { code: "40P01" });
      return "committed";
    });

    expect(result).toBe("committed");
    expect(tries).toBe(2);
  });

  it("re-executes a statement run without a transaction after a serialization failure", async ({
    stateProvider,
  }) => {
    let executions = 0;
    const stateAdapter = createPgStateAdapter({
      stateProvider: {
        ...stateProvider,
        executeSql: async (options) => {
          executions++;
          if (executions < 5) throw Object.assign(new Error("conflict"), { code: "40001" });
          return stateProvider.executeSql(options);
        },
      },
    });

    expect(await stateAdapter.getStartAttemptDelayMs({ typeNames: ["retried"] })).toBeNull();
    expect(executions).toBe(5);
  });

  it("throws the serialization failure of the fifth execution of a statement", async ({
    stateProvider,
  }) => {
    let executions = 0;
    const stateAdapter = createPgStateAdapter({
      stateProvider: {
        ...stateProvider,
        executeSql: async () => {
          executions++;
          throw Object.assign(new Error("conflict"), { code: "40001" });
        },
      },
    });

    await expect(
      stateAdapter.getStartAttemptDelayMs({ typeNames: ["retried"] }),
    ).rejects.toMatchObject({ code: "40001" });
    expect(executions).toBe(5);
  });

  it("does not re-execute a statement run in the caller's transaction", async ({
    stateProvider,
  }) => {
    let executions = 0;
    const stateAdapter = createPgStateAdapter({
      stateProvider: {
        ...stateProvider,
        executeSql: async (options) => {
          if (options.txCtx === undefined) return stateProvider.executeSql(options);
          executions++;
          throw Object.assign(new Error("conflict"), { code: "40001" });
        },
      },
    });

    await expect(
      stateProvider.withTransaction(async (txCtx) =>
        stateAdapter.getStartAttemptDelayMs({ txCtx, typeNames: ["retried"] }),
      ),
    ).rejects.toMatchObject({ code: "40001" });
    expect(executions).toBe(1);
  });

  it("tries up to transactionRetry.maxTries times", async ({ stateProvider }) => {
    const stateAdapter = createPgStateAdapter({
      stateProvider,
      transactionRetry: { maxTries: 2, initialDelayMs: 0, maxDelayMs: 0 },
    });
    let tries = 0;

    await expect(
      stateAdapter.withTransaction(async () => {
        tries++;
        throw Object.assign(new Error("conflict"), { code: "40001" });
      }),
    ).rejects.toMatchObject({ code: "40001" });
    expect(tries).toBe(2);
  });
});
