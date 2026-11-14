import { sleep } from "@queuert/helpers/sleep";
import type { Pool } from "mysql2/promise";
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

import { createMysqlStateProviderConformanceContext } from "../conformance/state-provider-conformance.ts";
import { createMysqlStateAdapter } from "../state-adapter/state-adapter.mysql.ts";
import {
  withMysql2PoolNonTransactionContext,
  withMysql2PoolSavepoint,
} from "../state-provider/state-provider.mysql2-pool.spec-helper.ts";
import {
  type Mysql2PoolContext,
  type Mysql2PoolProvider,
  createMysql2PoolProvider,
} from "../state-provider/state-provider.mysql2-pool.ts";

type EndToEndContext = EndToEndSavepointContext &
  EndToEndPoisonTransactionContext &
  EndToEndFlakyDbContext;

const createFlakyStateAdapter = (
  pool: Pool,
  dialect: "mysql" | "mariadb",
  failStatement: (
    executeSql: Mysql2PoolProvider["executeSql"],
    options: Parameters<Mysql2PoolProvider["executeSql"]>[0],
  ) => ReturnType<Mysql2PoolProvider["executeSql"]>,
): StateAdapter<any, any, any, "async"> => {
  const stateProvider = createMysql2PoolProvider({ pool });
  const executeSql = stateProvider.executeSql.bind(stateProvider);
  // MySQL has no RETURNING or data-modifying CTEs, so a claim or completion runs ~3x the
  // statements it does on PostgreSQL; the default success batches leave concurrent workers
  // too few consecutive successes to commit and the multi-worker cases crawl past the timeout
  const shouldError = createFlakyBatchGenerator({ successBatchSize: { min: 15, max: 45 } });
  let enabled = true;
  let statementCount = 0;
  let errorCount = 0;

  const stateAdapter = createMysqlStateAdapter({
    dialect,
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

const POISON_SQL = "SELECT 1 FROM nonexistent_table_queuert_poison_xyz";

export const createEndToEndContext = async (
  pool: Pool,
  dialect: "mysql" | "mariadb",
  createNotifyAdapter: EndToEndContext["createNotifyAdapter"],
): Promise<EndToEndContext> => ({
  ...(await createMysqlStateProviderConformanceContext({
    createStateProvider: async () => createMysql2PoolProvider({ pool }),
    dialect,
    withNonTransactionContext: withMysql2PoolNonTransactionContext(pool),
    withSavepoint: withMysql2PoolSavepoint,
  })),
  withSavepoint: withMysql2PoolSavepoint,
  createNotifyAdapter,
  poisonTransaction: async (txCtx) => {
    await (txCtx as Mysql2PoolContext).connection.query(POISON_SQL);
  },
  createFlakyDbStateAdapter: async () =>
    createFlakyStateAdapter(pool, dialect, async (executeSql, options) =>
      executeSql({
        txCtx: options.txCtx,
        sql: POISON_SQL,
        params: [],
        paramTypes: {},
        columnTypes: {},
        readOnly: true,
      }),
    ),
  createFlakyConnectionStateAdapter: async () =>
    createFlakyStateAdapter(pool, dialect, async () => {
      const error = new Error("connection reset") as Error & { code: string };
      error.code = "ECONNRESET";
      throw error;
    }),
});

export const capabilityGroups: ConformanceGroup<EndToEndContext>[] = [
  ...endToEndConcurrentTransactionGroups,
  ...endToEndSavepointGroups,
  ...endToEndPoisonTransactionGroups,
  ...endToEndFlakyDbGroups,
  ...endToEndFlakyDbConcurrentTransactionGroups,
];
