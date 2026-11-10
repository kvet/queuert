import type { ConformanceOptions, ConformanceReport } from "queuert/conformance";
import {
  type ConformanceGroup,
  type SchemaFenceConformanceFixture,
  runFixtureConformance,
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
  stateAdapterSchemaFenceConcurrentTransactionGroups,
  stateAdapterSchemaFenceGroups,
} from "queuert/conformance-internal";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";
import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";

/** Fixture for {@link runPgStateProviderConformance}. */
export type PgStateProviderConformanceFixture = {
  /** The provider under test, over a database the suite may create tables in. */
  stateProvider: PgStateProvider<any>;
  /**
   * Runs the callback with a context of the provider's shape that is not inside a transaction
   * (e.g. a pool client with no `BEGIN`), so the suite can check `isTransaction` rejects it.
   * Cases that need it are skipped when omitted.
   */
  withNonTransactionContext?: <T>(fn: (txCtx: any) => Promise<T>) => Promise<T>;
  /** Called once after all cases finish (pass or fail) to release resources. */
  dispose?: () => Promise<void>;
};

export type PgStateProviderConformanceContext = SchemaFenceConformanceFixture & {
  stateProvider: PgStateProvider<any>;
};

const MISSING_TABLE = "public.queuert_conformance_missing";

const executeSql = async (
  stateProvider: PgStateProvider<any>,
  sql: string,
  txCtx?: unknown,
): Promise<unknown[]> =>
  stateProvider.executeSql({
    txCtx,
    sql,
    params: [],
    paramTypes: {},
    columnTypes: {},
    readOnly: true,
  });

const captureError = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the statement to fail");
};

export const classifyErrorGroup: ConformanceGroup<PgStateProviderConformanceContext> = {
  name: "classifyError",
  cases: [
    {
      name: "classifies a missing table as undefined_table, naming it",
      run: async ({ stateProvider }, expect) => {
        const error = await captureError(async () =>
          executeSql(stateProvider, `SELECT 1 FROM ${MISSING_TABLE}`),
        );
        expect(stateProvider.classifyError({ error })).toEqual({
          kind: "undefined_table",
          tableName: MISSING_TABLE,
        });
      },
    },
    {
      name: "classifies a missing table inside a transaction as undefined_table, naming it",
      run: async ({ stateProvider }, expect) => {
        let error: unknown;
        await expect(
          stateProvider.withTransaction(async (txCtx) => {
            error = await captureError(async () =>
              executeSql(stateProvider, `SELECT 1 FROM ${MISSING_TABLE}`, txCtx),
            );
            throw error;
          }),
        ).rejects.toThrow();
        expect(stateProvider.classifyError({ error })).toEqual({
          kind: "undefined_table",
          tableName: MISSING_TABLE,
        });
      },
    },
    {
      name: "returns undefined for an error other than a missing table",
      run: async ({ stateProvider }, expect) => {
        const error = await captureError(async () =>
          executeSql(stateProvider, "SELECT missing_column FROM public.queuert_job"),
        );
        expect(stateProvider.classifyError({ error })).toBeUndefined();
      },
    },
    {
      name: "returns undefined for a value that is not a driver error",
      run: async ({ stateProvider }, expect) => {
        expect(stateProvider.classifyError({ error: new Error("unrelated") })).toBeUndefined();
        expect(stateProvider.classifyError({ error: undefined })).toBeUndefined();
      },
    },
  ],
};

const pgStateProviderBaseGroups: ConformanceGroup<PgStateProviderConformanceContext>[] = [
  ...stateAdapterBaseGroups,
  ...stateAdapterSchemaFenceGroups,
  classifyErrorGroup,
];

export const pgStateProviderConformanceGroups: ConformanceGroup<PgStateProviderConformanceContext>[] =
  [
    ...pgStateProviderBaseGroups,
    ...stateAdapterConcurrentTransactionGroups,
    ...stateAdapterSchemaFenceConcurrentTransactionGroups,
  ];

export const createPgConformanceContext = async ({
  stateProvider,
  withNonTransactionContext,
  dispose,
}: PgStateProviderConformanceFixture): Promise<
  PgStateProviderConformanceContext & { reset: () => Promise<void>; dispose?: () => Promise<void> }
> => {
  const stateAdapter = createPgStateAdapter({ stateProvider });
  await stateAdapter.migrateToLatest();
  const executeDdl = async (sql: string): Promise<void> => {
    await stateProvider.executeSql({
      sql,
      params: [],
      paramTypes: {},
      columnTypes: {},
      readOnly: false,
    });
  };
  return {
    stateAdapter,
    stateProvider,
    withNonTransactionContext,
    withWritesFenced: async (fn) => {
      await executeDdl("DROP TABLE public.queuert_schema_fence_v1");
      try {
        return await fn();
      } finally {
        await executeDdl("CREATE TABLE public.queuert_schema_fence_v1 (id integer PRIMARY KEY)");
      }
    },
    reset: async () => stateAdapter.truncate(),
    dispose,
  };
};

/**
 * Run the conformance suite against a {@link PgStateProvider}: every state adapter case, run
 * through `createPgStateAdapter` over the provider, including the cases that hold two
 * transactions open at once, and the provider's `classifyError`. The adapter is migrated once
 * and truncated before every case. Test-framework agnostic: designed to be embedded in a single
 * test. Throws `ConformanceError` with an aggregated report on any failure.
 *
 * @example
 * ```ts
 * await runPgStateProviderConformance(async () => {
 *   const pool = new Pool({ connectionString });
 *   return {
 *     stateProvider: createPgPoolStateProvider({ pool }),
 *     dispose: async () => pool.end(),
 *   };
 * });
 * ```
 */
export const runPgStateProviderConformance = async (
  factory: () => Promise<PgStateProviderConformanceFixture>,
  options?: ConformanceOptions,
): Promise<ConformanceReport> => {
  const fixture = await factory();
  return runFixtureConformance(
    pgStateProviderConformanceGroups,
    async () => createPgConformanceContext(fixture),
    options,
  );
};
