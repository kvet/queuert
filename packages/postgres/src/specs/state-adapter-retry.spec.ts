import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { it as baseIt, describe, expect } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import { createPgPoolProvider } from "../state-provider/state-provider.pg-pool.ts";

const pg = await acquirePostgres("postgres:14", import.meta.url);

// oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
const it = baseIt.extend("database", { scope: "file" }, async ({}, { onCleanup }) => {
  const pool = new Pool({ connectionString: pg.connectionString, idleTimeoutMillis: 0 });
  onCleanup(async () => pool.end());
  const provider = createPgPoolProvider({ pool });
  await createPgStateAdapter({ stateProvider: provider }).migrateToLatest();
  const injected = { autocommit: 0, inTransaction: 0, code: "40001", executions: 0 };
  const stateAdapter = createPgStateAdapter({
    stateProvider: {
      ...provider,
      executeSql: async (options) => {
        injected.executions++;
        if (
          options.txCtx === undefined ? injected.autocommit-- > 0 : injected.inTransaction-- > 0
        ) {
          throw Object.assign(new Error("injected"), { code: injected.code });
        }
        return provider.executeSql(options);
      },
    },
  });
  return { provider, stateAdapter, injected };
});

describe("retries of serialization failures", () => {
  const code = "40001";
  it(`withTransaction calls fn again on ${code}`, async ({ database: { stateAdapter } }) => {
    let tries = 0;
    const result = await stateAdapter.withTransaction(async () => {
      tries++;
      if (tries < 5) throw Object.assign(new Error("injected"), { code });
      return "committed";
    });
    expect(result).toBe("committed");
    expect(tries).toBe(5);
  });

  it(`withTransaction throws ${code} after the fifth try`, async ({
    database: { stateAdapter },
  }) => {
    let tries = 0;
    await expect(
      stateAdapter.withTransaction(async () => {
        tries++;
        throw Object.assign(new Error("injected"), { code });
      }),
    ).rejects.toMatchObject({ code });
    expect(tries).toBe(5);
  });

  it(`re-executes an autocommit statement on ${code}`, async ({
    database: { stateAdapter, injected },
  }) => {
    Object.assign(injected, { code, autocommit: 4, executions: 0 });
    expect(await stateAdapter.getStartAttemptDelayMs({ typeNames: ["retried"] })).toBeNull();
    expect(injected.executions).toBe(5);
  });

  it(`throws ${code} from an autocommit statement after the fifth execution`, async ({
    database: { stateAdapter, injected },
  }) => {
    Object.assign(injected, { code, autocommit: 5, executions: 0 });
    await expect(
      stateAdapter.getStartAttemptDelayMs({ typeNames: ["retried"] }),
    ).rejects.toMatchObject({ code });
    expect(injected.executions).toBe(5);
  });

  it(`never retries a statement on a caller's transaction on ${code}`, async ({
    database: { provider, stateAdapter, injected },
  }) => {
    Object.assign(injected, { code, inTransaction: 1, executions: 0 });
    await expect(
      provider.withTransaction(async (txCtx) =>
        stateAdapter.getStartAttemptDelayMs({ txCtx, typeNames: ["retried"] }),
      ),
    ).rejects.toMatchObject({ code });
    expect(injected.executions).toBe(1);
  });

  it("does not retry a deadlock", async ({ database: { stateAdapter } }) => {
    let tries = 0;
    await expect(
      stateAdapter.withTransaction(async () => {
        tries++;
        throw Object.assign(new Error("injected"), { code: "40P01" });
      }),
    ).rejects.toMatchObject({ code: "40P01" });
    expect(tries).toBe(1);
  });
});
