import { type ConformanceGroup } from "./runner.js";
import { addJobsBlockersGroup } from "./state-adapter-cases/add-jobs-blockers.js";
import { closeGroup } from "./state-adapter-cases/close.js";
import { completeJobsGroup } from "./state-adapter-cases/complete-jobs.js";
import { continueJobsGroup } from "./state-adapter-cases/continue-jobs.js";
import { countByChainTypeNamesGroup } from "./state-adapter-cases/count-by-chain-type-names.js";
import { countByJobTypeNamesGroup } from "./state-adapter-cases/count-by-job-type-names.js";
import { createJobsGroup } from "./state-adapter-cases/create-jobs.js";
import { deleteChainsGroup } from "./state-adapter-cases/delete-chains.js";
import { extendJobAttemptGroup } from "./state-adapter-cases/extend-job-attempt.js";
import { getChainsGroup } from "./state-adapter-cases/get-chains.js";
import { getJobBlockersGroup } from "./state-adapter-cases/get-job-blockers.js";
import { getJobsGroup } from "./state-adapter-cases/get-jobs.js";
import { getStartAttemptDelayMsGroup } from "./state-adapter-cases/get-start-attempt-delay-ms.js";
import { listBlockedJobsGroup } from "./state-adapter-cases/list-blocked-jobs.js";
import { listChainJobsGroup } from "./state-adapter-cases/list-chain-jobs.js";
import { listChainTypeNamesGroup } from "./state-adapter-cases/list-chain-type-names.js";
import { listChainsGroup } from "./state-adapter-cases/list-chains.js";
import { listJobTypeNamesGroup } from "./state-adapter-cases/list-job-type-names.js";
import { listJobsGroup } from "./state-adapter-cases/list-jobs.js";
import { reclaimExpiredJobAttemptGroup } from "./state-adapter-cases/reclaim-expired-job-attempt.js";
import { rescheduleJobsGroup } from "./state-adapter-cases/reschedule-jobs.js";
import { startJobAttemptGroup } from "./state-adapter-cases/start-job-attempt.js";
import { type StateConformanceFixture } from "./state-adapter-cases/types.js";
import { unblockJobsGroup } from "./state-adapter-cases/unblock-jobs.js";
import { withSavepointGroup } from "./state-adapter-cases/with-savepoint.js";
import { withTransactionGroup } from "./state-adapter-cases/with-transaction.js";

export { type StateConformanceFixture } from "./state-adapter-cases/types.js";

export const stateAdapterConformanceGroups: ConformanceGroup<StateConformanceFixture>[] = [
  withTransactionGroup,
  withSavepointGroup,
  getChainsGroup,
  getJobsGroup,
  createJobsGroup,
  continueJobsGroup,
  addJobsBlockersGroup,
  getJobBlockersGroup,
  unblockJobsGroup,
  startJobAttemptGroup,
  extendJobAttemptGroup,
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
