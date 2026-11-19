import { sleep } from "@queuert/helpers/sleep";
import type { Pool } from "pg";
import type { StateAdapter } from "queuert";
import {
  type ConformanceGroup,
  type EndToEndFlakyDbContext,
  type EndToEndPoisonTransactionContext,
  type EndToEndSavepointContext,
  createFlakyBatchGenerator,
  endToEndConcurrentTransactionGroups,
  endToEndFlakyDbConcurrentTransactionGroups,
  endToEndFlakyDbGroups,
  endToEndPoisonTransactionGroups,
  endToEndSavepointGroups,
} from "queuert/conformance-internal";

import { createPgStateProviderConformanceContext } from "../conformance/state-provider-conformance.ts";
import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import {
  withPgPoolNonTransactionContext,
  withPgPoolSavepoint,
} from "../state-provider/state-provider.pg-pool.spec-helper.ts";
import {
  type PgPoolContext,
  type PgPoolProvider,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";

const createFlakyStateAdapter = (
  pool: Pool,
  failStatements: (
    executeStatements: PgPoolProvider["executeStatements"],
    options: Parameters<PgPoolProvider["executeStatements"]>[0],
  ) => ReturnType<PgPoolProvider["executeStatements"]>,
): StateAdapter<any, any, any, "async"> => {
  const stateProvider = createPgPoolProvider({ pool });
  const executeStatements = stateProvider.executeStatements.bind(stateProvider);
  const shouldError = createFlakyBatchGenerator();
  let enabled = true;
  let batchCount = 0;
  let errorCount = 0;

  const stateAdapter = createPgStateAdapter({
    stateProvider: {
      ...stateProvider,
      executeStatements: async (options) => {
        batchCount++;
        if (enabled && shouldError()) {
          errorCount++;
          return failStatements(executeStatements, options);
        }
        return executeStatements(options);
      },
    },
  });

  const close = async (): Promise<void> => {
    enabled = false;
    await sleep(50);
    await stateAdapter.close();
    if (batchCount > 5 && errorCount === 0) {
      throw new Error(`the flaky provider failed none of its ${batchCount} batches`);
    }
  };
  return { ...stateAdapter, close, [Symbol.asyncDispose]: close };
};

export const createEndToEndContext = async (
  pool: Pool,
  createNotifyAdapter?: EndToEndSavepointContext["createNotifyAdapter"],
): Promise<
  EndToEndSavepointContext & EndToEndPoisonTransactionContext & EndToEndFlakyDbContext
> => ({
  ...createPgStateProviderConformanceContext({
    createStateProvider: async () => createPgPoolProvider({ pool }),
    withNonTransactionContext: withPgPoolNonTransactionContext(pool),
    withSavepoint: withPgPoolSavepoint,
  }),
  withSavepoint: withPgPoolSavepoint,
  createNotifyAdapter,
  poisonTransaction: async (txCtx) => {
    const { poolClient } = txCtx as PgPoolContext;
    await poolClient.query("SELECT 1 FROM nonexistent_table_queuert_poison_xyz");
  },
  createFlakyDbStateAdapter: async () =>
    createFlakyStateAdapter(pool, async (executeStatements, options) =>
      executeStatements({
        txCtx: options.txCtx,
        statements: [
          {
            sql: "SELECT 1 FROM nonexistent_table_queuert_poison_xyz",
            params: [],
            paramTypes: {},
            columnTypes: {},
            readOnly: true,
          },
        ],
      }),
    ),
  createFlakyConnectionStateAdapter: async () =>
    createFlakyStateAdapter(pool, async () => {
      const error = new Error("connection reset") as Error & { code: string };
      error.code = "ECONNRESET";
      throw error;
    }),
});

export const capabilityGroups: ConformanceGroup<
  EndToEndSavepointContext & EndToEndPoisonTransactionContext & EndToEndFlakyDbContext
>[] = [
  ...endToEndConcurrentTransactionGroups,
  ...endToEndSavepointGroups,
  ...endToEndPoisonTransactionGroups,
  ...endToEndFlakyDbGroups,
  ...endToEndFlakyDbConcurrentTransactionGroups,
];
