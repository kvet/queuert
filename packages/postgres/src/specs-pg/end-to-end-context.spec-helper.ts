import { sleep } from "@queuert/helpers";
import type { Pool } from "pg";
import type { NotifyAdapter, StateAdapter } from "queuert";
import {
  type EndToEndFlakyDbContext,
  type EndToEndPoisonTransactionContext,
  type EndToEndSavepointContext,
  createFlakyBatchGenerator,
} from "queuert/conformance-internal";

import { createPgStateProviderConformanceContext } from "../conformance/state-provider-conformance.ts";
import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import { withPgPoolNonTransactionContext } from "../state-provider/state-provider.pg-pool.spec-helper.ts";
import {
  type PgPoolContext,
  type PgPoolProvider,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";

const createFlakyStateAdapter = (
  pool: Pool,
  failStatement: (
    executeSql: PgPoolProvider["executeSql"],
    options: Parameters<PgPoolProvider["executeSql"]>[0],
  ) => ReturnType<PgPoolProvider["executeSql"]>,
): StateAdapter<any, any, any> => {
  const stateProvider = createPgPoolProvider({ pool });
  const executeSql = stateProvider.executeSql.bind(stateProvider);
  const shouldError = createFlakyBatchGenerator();
  let enabled = true;
  let statementCount = 0;
  let errorCount = 0;

  const stateAdapter = createPgStateAdapter({
    stateProvider: {
      ...stateProvider,
      executeSql: async (options) => {
        statementCount++;
        if (enabled && shouldError()) {
          errorCount++;
          return failStatement(executeSql, options);
        }
        return executeSql(options);
      },
    },
  });

  const close = async (): Promise<void> => {
    enabled = false;
    await sleep(50);
    await stateAdapter.close();
    if (statementCount > 5 && errorCount === 0) {
      throw new Error(`the flaky provider failed none of its ${statementCount} statements`);
    }
  };
  return { ...stateAdapter, close, [Symbol.asyncDispose]: close };
};

const failWithDatabaseError = async (
  executeSql: PgPoolProvider["executeSql"],
  options: Parameters<PgPoolProvider["executeSql"]>[0],
): ReturnType<PgPoolProvider["executeSql"]> =>
  executeSql({
    txCtx: options.txCtx,
    sql: "SELECT 1 FROM nonexistent_table_queuert_poison_xyz",
    params: [],
    paramTypes: {},
    columnTypes: {},
    readOnly: true,
  });

const failWithConnectionError = async (): Promise<never> => {
  const error = new Error("connection reset") as Error & { code: string };
  error.code = "ECONNRESET";
  throw error;
};

export const createPgEndToEndContext = async ({
  pool,
  createNotifyAdapter,
}: {
  pool: Pool;
  createNotifyAdapter?: () => Promise<NotifyAdapter>;
}): Promise<
  EndToEndSavepointContext & EndToEndPoisonTransactionContext & EndToEndFlakyDbContext
> => ({
  ...(await createPgStateProviderConformanceContext({
    createStateProvider: async () => createPgPoolProvider({ pool }),
    withNonTransactionContext: withPgPoolNonTransactionContext(pool),
  })),
  createNotifyAdapter,
  withSavepoint: async (txCtx, fn) => {
    const { poolClient } = txCtx as PgPoolContext;
    await poolClient.query("SAVEPOINT queuert_test");
    try {
      const result = await fn(txCtx);
      await poolClient.query("RELEASE SAVEPOINT queuert_test");
      return result;
    } catch (error) {
      await poolClient.query("ROLLBACK TO SAVEPOINT queuert_test");
      throw error;
    }
  },
  poisonTransaction: async (txCtx) => {
    const { poolClient } = txCtx as PgPoolContext;
    await poolClient.query("SELECT 1 FROM nonexistent_table_queuert_poison_xyz");
  },
  createFlakyDbStateAdapter: async () => createFlakyStateAdapter(pool, failWithDatabaseError),
  createFlakyConnectionStateAdapter: async () =>
    createFlakyStateAdapter(pool, failWithConnectionError),
});
