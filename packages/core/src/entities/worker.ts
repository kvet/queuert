import type { StateWorkerInfo } from "../state-adapter/state-adapter.ts";
import type { Worker } from "./worker.types.ts";

export type * from "./worker.types.ts";

export const mapStateWorkerToWorker = (stateWorker: StateWorkerInfo): Worker<string> => ({
  id: stateWorker.id,
  typeNames: stateWorker.typeNames,
  concurrency: stateWorker.concurrency,
  startedAt: stateWorker.startedAt,
  leaseUntil: stateWorker.leaseUntil,
  expired: stateWorker.expired,
});
