import { type Client } from "../client.js";
import { type BaseTxContext, type StateAdapter } from "../state-adapter/state-adapter.js";
import { type AnyAttemptMiddleware, type AttemptMiddleware } from "../worker/attempt-middleware.js";
import { createProcessors } from "../worker/create-processors.js";
import { type Processors } from "../worker/processors.js";
import {
  type CleanupJobTypeDefinitions,
  cleanupJobTypeName,
  createCleanupJobTypes,
} from "./cleanup-job-types.js";

/** Chains listed and deleted per batch when no `batchSize` is given. */
const defaultBatchSize = 100;

/**
 * Processors for the built-in cleanup job. Deletes every completed chain that
 * finished longer ago than `input.retentionMs`, in batches, then schedules the
 * next run `input.intervalMs` out as a new chain.
 *
 * The client must have been created with {@link createCleanupJobTypes}. Only the
 * first run is scheduled by the caller — see the cleanup guide.
 *
 * @example
 * const worker = await createInProcessWorker({
 *   client,
 *   processors: [
 *     createCleanupProcessors({ client, attemptMiddleware: [tracingMiddleware] }),
 *     myProcessors,
 *   ],
 * });
 */
export const createCleanupProcessors = <
  TClientJobTypeDefinitions extends CleanupJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
  const TAttemptMiddleware extends readonly AnyAttemptMiddleware[] = readonly [],
>(options: {
  client: Client<TClientJobTypeDefinitions, TStateAdapter>;
  /**
   * Middleware chain for this slice. Supply the same instances a worker
   * configured with `requiredAttemptMiddleware` demands — the worker matches by
   * reference identity, so the built-in slice has to carry them itself.
   */
  attemptMiddleware?: TAttemptMiddleware &
    readonly AttemptMiddleware<TStateAdapter, any, any, any, any>[];
  /** Chains listed and deleted per batch. Defaults to 100. */
  batchSize?: number;
}): Processors<CleanupJobTypeDefinitions, TAttemptMiddleware> => {
  // The handler is written against a concrete adapter shape so the callback
  // contexts resolve instead of staying generic; the returned registry is
  // re-widened to TStateAdapter, which the caller's client determines.
  const client = options.client as unknown as Client<
    CleanupJobTypeDefinitions,
    StateAdapter<BaseTxContext, string>
  >;
  const attemptMiddleware = options.attemptMiddleware as unknown as
    | readonly AttemptMiddleware<StateAdapter<BaseTxContext, string>, any, any, any, any>[]
    | undefined;
  const batchSize = options.batchSize ?? defaultBatchSize;

  return createProcessors({
    client,
    jobTypes: createCleanupJobTypes(),
    ...(attemptMiddleware !== undefined ? { attemptMiddleware } : {}),
    processors: {
      [cleanupJobTypeName]: {
        attemptHandler: async ({ signal, job, execute, complete }) => {
          const { retentionMs, intervalMs } = job.input;
          const cutoffDate = new Date(Date.now() - retentionMs);
          let cursor: string | undefined;

          do {
            const page = await client.listChains({
              status: "completed",
              orderBy: "completedAt",
              orderDirection: "asc",
              independent: true,
              to: cutoffDate,
              limit: batchSize,
              ...(cursor != null ? { cursor } : {}),
            });

            const chainIdsToDelete = page.items
              .filter((chain) => chain.id !== job.chainId && chain.status === "completed")
              .map((chain) => chain.id);

            if (chainIdsToDelete.length > 0) {
              await execute(async ({ transactionHooks, ...txCtx }) =>
                client.deleteChains({
                  ...txCtx,
                  transactionHooks,
                  ids: chainIdsToDelete,
                }),
              );
            }

            cursor = page.nextCursor ?? undefined;
            // Deletion is idempotent and the next run resumes from the oldest
            // remaining chain, so a stopping worker can drop out mid-scan.
          } while (cursor != null && !signal.aborted);

          // TODO: reclaim disk space here once `vacuum()` is reachable from
          // core — it exists only on the concrete PostgreSQL and SQLite
          // adapters today, not on the `StateAdapter` interface.

          return complete(async ({ transactionHooks, ...txCtx }) => {
            await client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: cleanupJobTypeName,
              input: { retentionMs, intervalMs },
              schedule: { afterMs: intervalMs },
              deduplication: {
                key: cleanupJobTypeName,
                scope: "running",
                excludeChainIds: [job.chainId],
              },
            });

            return null;
          });
        },
      },
    },
  }) as unknown as Processors<CleanupJobTypeDefinitions, TAttemptMiddleware>;
};
