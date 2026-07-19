import { type ConformanceGroup } from "./runner.js";
import { addJobsBlockersGroup } from "./state-adapter-cases/add-jobs-blockers.js";
import { closeGroup } from "./state-adapter-cases/close.js";
import { createChainsGroup } from "./state-adapter-cases/create-chains.js";
import { createContinuationJobGroup } from "./state-adapter-cases/create-continuation-job.js";
import { deleteChainsGroup } from "./state-adapter-cases/delete-chains.js";
import { extendJobAttemptGroup } from "./state-adapter-cases/extend-job-attempt.js";
import { finishJobAttemptGroup } from "./state-adapter-cases/finish-job-attempt.js";
import { getChainsGroup } from "./state-adapter-cases/get-chains.js";
import { getJobBlockersGroup } from "./state-adapter-cases/get-job-blockers.js";
import { getJobsGroup } from "./state-adapter-cases/get-jobs.js";
import { getStartAttemptDelayMsGroup } from "./state-adapter-cases/get-start-attempt-delay-ms.js";
import { listBlockedJobsGroup } from "./state-adapter-cases/list-blocked-jobs.js";
import { listChainJobsGroup } from "./state-adapter-cases/list-chain-jobs.js";
import { listChainsGroup } from "./state-adapter-cases/list-chains.js";
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
  createChainsGroup,
  createContinuationJobGroup,
  addJobsBlockersGroup,
  getJobBlockersGroup,
  unblockJobsGroup,
  startJobAttemptGroup,
  extendJobAttemptGroup,
  finishJobAttemptGroup,
  reclaimExpiredJobAttemptGroup,
  getStartAttemptDelayMsGroup,
  rescheduleJobsGroup,
  deleteChainsGroup,
  listChainsGroup,
  listJobsGroup,
  listChainJobsGroup,
  listBlockedJobsGroup,
  closeGroup,
];
