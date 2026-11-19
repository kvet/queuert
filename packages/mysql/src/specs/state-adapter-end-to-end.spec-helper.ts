import { sleep } from "@queuert/helpers/sleep";
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
import type { MysqlStateProvider } from "../state-provider/state-provider.mysql.ts";

type EndToEndContext = EndToEndSavepointContext &
  EndToEndPoisonTransactionContext &
  EndToEndFlakyDbContext;

type ExecuteStatements = MysqlStateProvider<any>["executeStatements"];

const POISON_SQL = "SELECT 1 FROM nonexistent_table_queuert_poison_xyz";

const createFlakyStateAdapter = (
  stateProvider: MysqlStateProvider<any>,
  dialect: "mysql" | "mariadb",
  failBatch: (
    executeStatements: ExecuteStatements,
    options: Parameters<ExecuteStatements>[0],
  ) => ReturnType<ExecuteStatements>,
): StateAdapter<any, any, any, "async"> => {
  const executeStatements = stateProvider.executeStatements.bind(stateProvider);
  const shouldError = createFlakyBatchGenerator({ successBatchSize: { min: 15, max: 45 } });
  let enabled = true;
  let statementCount = 0;
  let errorCount = 0;

  const stateAdapter = createMysqlStateAdapter({
    dialect,
    stateProvider: {
      ...stateProvider,
      executeStatements: async (options) => {
        statementCount += options.statements.length;
        if (enabled && options.statements.map(() => shouldError()).includes(true)) {
          errorCount++;
          return failBatch(executeStatements, options);
        }
        return executeStatements(options);
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

export const createProviderEndToEndContext = async <TTxContext extends Record<string, unknown>>({
  createStateProvider,
  dialect,
  withNonTransactionContext,
  withSavepoint,
  createNotifyAdapter,
}: {
  createStateProvider: () => MysqlStateProvider<TTxContext>;
  dialect: "mysql" | "mariadb";
  withNonTransactionContext: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  withSavepoint: <T>(txCtx: TTxContext, fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  createNotifyAdapter: EndToEndContext["createNotifyAdapter"];
}): Promise<EndToEndContext> => ({
  ...createMysqlStateProviderConformanceContext({
    createStateProvider: async () => createStateProvider(),
    dialect,
    withNonTransactionContext,
    withSavepoint,
  }),
  withSavepoint,
  createNotifyAdapter,
  poisonTransaction: async (txCtx) => {
    await createStateProvider().executeStatements({
      txCtx,
      statements: [
        { sql: POISON_SQL, params: [], paramTypes: {}, columnTypes: {}, readOnly: true },
      ],
    });
  },
  createFlakyDbStateAdapter: async () =>
    createFlakyStateAdapter(createStateProvider(), dialect, async (executeStatements, options) =>
      executeStatements({
        txCtx: options.txCtx,
        statements: [
          { sql: POISON_SQL, params: [], paramTypes: {}, columnTypes: {}, readOnly: true },
        ],
      }),
    ),
  createFlakyConnectionStateAdapter: async () =>
    createFlakyStateAdapter(createStateProvider(), dialect, async () => {
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
