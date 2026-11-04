import { type StateWorkerInfo } from "../state-adapter/state-adapter.js";
import { type Worker } from "./worker.types.js";

export type * from "./worker.types.js";

export const mapStateWorkerToWorker = (stateWorker: StateWorkerInfo): Worker<string> => ({
  id: stateWorker.id,
  typeNames: stateWorker.typeNames,
  concurrency: stateWorker.concurrency,
  startedAt: stateWorker.startedAt,
  leaseUntil: stateWorker.leaseUntil,
  expired: stateWorker.expired,
});
