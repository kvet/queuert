import { type ConformanceGroup } from "./runner.js";
import { acquireJobGroup } from "./state-adapter-cases/acquire-job.js";
import { addJobsBlockersTraceContextsGroup } from "./state-adapter-cases/add-jobs-blockers-trace-contexts.js";
import { addJobsBlockersGroup } from "./state-adapter-cases/add-jobs-blockers.js";
import { closeGroup } from "./state-adapter-cases/close.js";
import { completeJobGroup } from "./state-adapter-cases/complete-job.js";
import { concurrencyGroup } from "./state-adapter-cases/concurrency.js";
import { createJobsGroup } from "./state-adapter-cases/create-jobs.js";
import { deleteJobChainsGroup } from "./state-adapter-cases/delete-job-chains.js";
import { getJobBlockersGroup } from "./state-adapter-cases/get-job-blockers.js";
import { getJobByIdGroup } from "./state-adapter-cases/get-job-by-id.js";
import { getJobChainByIdGroup } from "./state-adapter-cases/get-job-chain-by-id.js";
import { getJobForUpdateGroup } from "./state-adapter-cases/get-job-for-update.js";
import { getLatestChainJobForUpdateGroup } from "./state-adapter-cases/get-latest-chain-job-for-update.js";
import { getNextJobAvailableInMsGroup } from "./state-adapter-cases/get-next-job-available-in-ms.js";
import { listBlockedJobsGroup } from "./state-adapter-cases/list-blocked-jobs.js";
import { listJobChainJobsGroup } from "./state-adapter-cases/list-job-chain-jobs.js";
import { listJobChainsGroup } from "./state-adapter-cases/list-job-chains.js";
import { listJobsGroup } from "./state-adapter-cases/list-jobs.js";
import { readIsolationGroup } from "./state-adapter-cases/read-isolation.js";
import { reapExpiredJobLeaseGroup } from "./state-adapter-cases/reap-expired-job-lease.js";
import { renewJobLeaseGroup } from "./state-adapter-cases/renew-job-lease.js";
import { rescheduleJobGroup } from "./state-adapter-cases/reschedule-job.js";
import { triggerJobsGroup } from "./state-adapter-cases/trigger-jobs.js";
import { type StateAdapterConformanceContext } from "./state-adapter-cases/types.js";
import { unblockJobsGroup } from "./state-adapter-cases/unblock-jobs.js";
import { withSavepointGroup } from "./state-adapter-cases/with-savepoint.js";
import { withTransactionGroup } from "./state-adapter-cases/with-transaction.js";

export { type StateAdapterConformanceContext } from "./state-adapter-cases/types.js";

export const stateAdapterConformanceGroups: ConformanceGroup<StateAdapterConformanceContext>[] = [
  createJobsGroup,
  withTransactionGroup,
  getJobChainByIdGroup,
  addJobsBlockersGroup,
  unblockJobsGroup,
  addJobsBlockersTraceContextsGroup,
  getJobBlockersGroup,
  getNextJobAvailableInMsGroup,
  acquireJobGroup,
  renewJobLeaseGroup,
  rescheduleJobGroup,
  triggerJobsGroup,
  completeJobGroup,
  reapExpiredJobLeaseGroup,
  deleteJobChainsGroup,
  getJobByIdGroup,
  getJobForUpdateGroup,
  getLatestChainJobForUpdateGroup,
  listJobChainsGroup,
  listJobsGroup,
  listJobChainJobsGroup,
  listBlockedJobsGroup,
  withSavepointGroup,
  concurrencyGroup,
  readIsolationGroup,
  closeGroup,
];
