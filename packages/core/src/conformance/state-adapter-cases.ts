import { type ConformanceGroup } from "./runner.js";
import { addJobsBlockersGroup } from "./state-adapter-cases/add-jobs-blockers.js";
import { closeGroup } from "./state-adapter-cases/close.js";
import { completeJobsGroup } from "./state-adapter-cases/complete-jobs.js";
import { continueJobsGroup } from "./state-adapter-cases/continue-jobs.js";
import { countByChainTypeNamesGroup } from "./state-adapter-cases/count-by-chain-type-names.js";
import { countByJobTypeNamesGroup } from "./state-adapter-cases/count-by-job-type-names.js";
import { countWorkersByTypeNamesGroup } from "./state-adapter-cases/count-workers-by-type-names.js";
import { createJobsGroup } from "./state-adapter-cases/create-jobs.js";
import { deleteChainsGroup } from "./state-adapter-cases/delete-chains.js";
import { extendWorkerLeaseGroup } from "./state-adapter-cases/extend-worker-lease.js";
import { getChainsGroup } from "./state-adapter-cases/get-chains.js";
import { getJobBlockersGroup } from "./state-adapter-cases/get-job-blockers.js";
import { getJobsGroup } from "./state-adapter-cases/get-jobs.js";
import { getStartAttemptDelayMsGroup } from "./state-adapter-cases/get-start-attempt-delay-ms.js";
import { getWorkersGroup } from "./state-adapter-cases/get-workers.js";
import { isTransactionGroup } from "./state-adapter-cases/is-transaction.js";
import { listBlockedJobsGroup } from "./state-adapter-cases/list-blocked-jobs.js";
import { listChainJobsGroup } from "./state-adapter-cases/list-chain-jobs.js";
import { listChainTypeNamesGroup } from "./state-adapter-cases/list-chain-type-names.js";
import { listChainsGroup } from "./state-adapter-cases/list-chains.js";
import { listJobTypeNamesGroup } from "./state-adapter-cases/list-job-type-names.js";
import { listJobsGroup } from "./state-adapter-cases/list-jobs.js";
import { listWorkerJobsGroup } from "./state-adapter-cases/list-worker-jobs.js";
import { listWorkersGroup } from "./state-adapter-cases/list-workers.js";
import { reclaimExpiredJobAttemptGroup } from "./state-adapter-cases/reclaim-expired-job-attempt.js";
import { rescheduleJobsGroup } from "./state-adapter-cases/reschedule-jobs.js";
import { startJobAttemptGroup } from "./state-adapter-cases/start-job-attempt.js";
import { startWorkerGroup } from "./state-adapter-cases/start-worker.js";
import { stopWorkerGroup } from "./state-adapter-cases/stop-worker.js";
import { type StateConformanceFixture } from "./state-adapter-cases/types.js";
import { unblockJobsGroup } from "./state-adapter-cases/unblock-jobs.js";
import { withTransactionGroup } from "./state-adapter-cases/with-transaction.js";

export { type StateConformanceFixture } from "./state-adapter-cases/types.js";

export const stateAdapterConformanceGroups: ConformanceGroup<StateConformanceFixture>[] = [
  withTransactionGroup,
  isTransactionGroup,
  getChainsGroup,
  getJobsGroup,
  createJobsGroup,
  continueJobsGroup,
  addJobsBlockersGroup,
  getJobBlockersGroup,
  unblockJobsGroup,
  startJobAttemptGroup,
  startWorkerGroup,
  extendWorkerLeaseGroup,
  stopWorkerGroup,
  getWorkersGroup,
  listWorkersGroup,
  countWorkersByTypeNamesGroup,
  listWorkerJobsGroup,
  completeJobsGroup,
  reclaimExpiredJobAttemptGroup,
  getStartAttemptDelayMsGroup,
  rescheduleJobsGroup,
  deleteChainsGroup,
  listJobTypeNamesGroup,
  listChainTypeNamesGroup,
  countByJobTypeNamesGroup,
  countByChainTypeNamesGroup,
  listChainsGroup,
  listJobsGroup,
  listChainJobsGroup,
  listBlockedJobsGroup,
  closeGroup,
];
