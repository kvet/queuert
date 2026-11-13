import { conformanceTestSuite } from "@queuert/helpers/conformance";
// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { sleep } from "@queuert/helpers/sleep";
import { acquireMysql } from "@queuert/testcontainers";
import { type Pool, createPool } from "mysql2/promise";
import type { StateAdapter } from "queuert";
import {
  type ConformanceGroup,
  type EndToEndFlakyDbContext,
  type EndToEndPoisonTransactionContext,
  type EndToEndSavepointContext,
  createFlakyBatchGenerator,
  endToEndBaseGroups,
  endToEndConcurrentTransactionGroups,
  endToEndFlakyDbConcurrentTransactionGroups,
  endToEndFlakyDbGroups,
  endToEndPoisonTransactionGroups,
  endToEndSavepointGroups,
  noopNotifyAdapter,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

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
): StateAdapter<any, any, any> => {
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

const createEndToEndContext = async (
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

const defineMysqlEndToEndSuite = async ({
  image,
  dialect,
  callerId,
}: {
  image: string;
  dialect: "mysql" | "mariadb";
  callerId: string;
}): Promise<void> => {
  const { connectionOptions } = await acquireMysql(image, callerId);

  const it = baseIt.extend("pool", { scope: "file" }, async ({}, { onCleanup }) => {
    const pool = createPool({ ...connectionOptions, connectionLimit: 20 });
    onCleanup(async () => pool.end());
    return pool;
  });
  const noopNotifyIt = it.extend("conformance", { scope: "file" }, async ({ pool }) =>
    createEndToEndContext(pool, dialect, async () => noopNotifyAdapter),
  );
  const inProcessNotifyIt = it.extend("conformance", { scope: "file" }, async ({ pool }) =>
    createEndToEndContext(pool, dialect, undefined),
  );

  const capabilityGroups: ConformanceGroup<EndToEndContext>[] = [
    ...endToEndConcurrentTransactionGroups,
    ...endToEndSavepointGroups,
    ...endToEndPoisonTransactionGroups,
    ...endToEndFlakyDbGroups,
    ...endToEndFlakyDbConcurrentTransactionGroups,
  ];

  describe(`${image} End-to-End Conformance, noop notify`, () => {
    conformanceTestSuite({
      it: noopNotifyIt,
      groups: [...endToEndBaseGroups, ...capabilityGroups],
    });
  });

  describe(`${image} End-to-End Conformance, in-process notify`, () => {
    conformanceTestSuite({
      it: inProcessNotifyIt,
      groups: [...endToEndBaseGroups, ...capabilityGroups],
    });
  });
};

// NOTE: hack for vitest plugin
baseIt("index");

for (const { image, dialect } of [
  { image: "mysql:8.4", dialect: "mysql" as const },
  { image: "mariadb:11.4", dialect: "mariadb" as const },
]) {
  await defineMysqlEndToEndSuite({ image, dialect, callerId: `${import.meta.url}-${dialect}` });
}
