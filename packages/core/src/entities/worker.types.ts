/**
 * A worker: one row in the `worker` table, live while its lease is.
 *
 * @typeParam TWorkerId - The worker ID type (e.g. `string` or `UUID`)
 */
export type Worker<TWorkerId> = {
  /** The worker ID, kept across restarts of the same worker runner. */
  id: TWorkerId;
  /** Job types the worker processes. */
  typeNames: string[];
  /** Most attempts the worker runs at once. */
  concurrency: number;
  /** When the worker registered. */
  startedAt: Date;
  /** When the lease ends unless renewed. */
  leaseUntil: Date;
  /** Whether the lease had ended in database time when the worker was read. */
  expired: boolean;
};
