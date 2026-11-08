import type {
  ConformanceOptions,
  ConformanceReport,
  StateConformanceFixture,
} from "queuert/conformance";
import {
  type ConformanceGroup,
  runFixtureConformance,
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
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

export const pgStateProviderConformanceGroups: ConformanceGroup<StateConformanceFixture>[] = [
  ...stateAdapterBaseGroups,
  ...stateAdapterConcurrentTransactionGroups,
];

export const createPgConformanceContext = async ({
  stateProvider,
  withNonTransactionContext,
  dispose,
}: PgStateProviderConformanceFixture): Promise<
  StateConformanceFixture & { reset: () => Promise<void>; dispose?: () => Promise<void> }
> => {
  const stateAdapter = createPgStateAdapter({ stateProvider });
  await stateAdapter.migrateToLatest();
  return {
    stateAdapter,
    withNonTransactionContext,
    reset: async () => stateAdapter.truncate(),
    dispose,
  };
};

/**
 * Run the conformance suite against a {@link PgStateProvider}: every state adapter case, run
 * through `createPgStateAdapter` over the provider, including the cases that hold two
 * transactions open at once. The adapter is migrated once and truncated before every case.
 * Test-framework agnostic: designed to be embedded in a single test. Throws `ConformanceError`
 * with an aggregated report on any failure.
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
