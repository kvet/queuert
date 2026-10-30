import { type StateWorker } from "../state-adapter/state-adapter.js";
import { type Worker } from "./worker.types.js";

export type * from "./worker.types.js";

export const mapStateWorkerToWorker = (stateWorker: StateWorker): Worker => ({
  id: stateWorker.id,
  name: stateWorker.name,
  typeNames: stateWorker.typeNames,
  concurrency: stateWorker.concurrency,
  startedAt: stateWorker.startedAt,
  leaseUntil: stateWorker.leaseUntil,
  runningJobCount: stateWorker.runningJobCount,
});
