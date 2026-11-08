import type {
  ConformanceOptions,
  ConformanceReport,
  StateConformanceFixture,
} from "queuert/conformance";
import {
  type ConformanceGroup,
  runFixtureConformance,
  stateAdapterBaseGroups,
} from "queuert/conformance-internal";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

/** Fixture for {@link runSqliteStateProviderConformance}. */
export type SqliteStateProviderConformanceFixture = {
  /** The provider under test, over an empty database. */
  stateProvider: SqliteStateProvider<any>;
  /**
   * Runs the callback with a context of the provider's shape that is not inside a transaction,
   * so the suite can check `isTransaction` rejects it. Cases that need it are skipped when
   * omitted.
   */
  withNonTransactionContext?: <T>(fn: (txCtx: any) => Promise<T>) => Promise<T>;
  /** Called once after all cases finish (pass or fail) to release resources. */
  dispose?: () => Promise<void>;
};

export const sqliteStateProviderConformanceGroups: ConformanceGroup<StateConformanceFixture>[] = [
  ...stateAdapterBaseGroups,
];

export const createSqliteConformanceContext = async ({
  stateProvider,
  withNonTransactionContext,
  dispose,
}: SqliteStateProviderConformanceFixture): Promise<
  StateConformanceFixture & { reset: () => Promise<void>; dispose?: () => Promise<void> }
> => {
  const stateAdapter = createSqliteStateAdapter({ stateProvider });
  await stateAdapter.migrateToLatest();
  return {
    stateAdapter,
    withNonTransactionContext,
    reset: async () => stateAdapter.truncate(),
    dispose,
  };
};

/**
 * Run the conformance suite against a {@link SqliteStateProvider}: every state adapter case,
 * run through `createSqliteStateAdapter` over the provider. The adapter is migrated once and
 * truncated before every case. Test-framework agnostic: designed to be embedded in a single
 * test. Throws `ConformanceError` with an aggregated report on any failure.
 *
 * @example
 * ```ts
 * await runSqliteStateProviderConformance(async () => {
 *   const client = createClient({ url: ":memory:" });
 *   return {
 *     stateProvider: createLibsqlStateProvider({ client }),
 *     dispose: async () => client.close(),
 *   };
 * });
 * ```
 */
export const runSqliteStateProviderConformance = async (
  factory: () => Promise<SqliteStateProviderConformanceFixture>,
  options?: ConformanceOptions,
): Promise<ConformanceReport> => {
  const fixture = await factory();
  return runFixtureConformance(
    sqliteStateProviderConformanceGroups,
    async () => createSqliteConformanceContext(fixture),
    options,
  );
};
