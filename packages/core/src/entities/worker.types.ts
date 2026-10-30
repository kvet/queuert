/** A worker: one row in the `worker` table, live while its lease is. */
export type Worker = {
  id: string;
  /** The in-process worker's `workerName`. */
  name: string | null;
  /** Job types the worker processes. */
  typeNames: string[];
  /** Most attempts the worker runs at once. */
  concurrency: number;
  startedAt: Date;
  /** When the lease ends unless renewed. */
  leaseUntil: Date;
  /** Jobs `running` under this worker when it was read. */
  runningJobCount: number;
};
