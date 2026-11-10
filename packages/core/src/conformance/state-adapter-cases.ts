import type { ConformanceGroup } from "./runner.ts";
import {
  addJobsBlockersGroup,
  addJobsBlockersConcurrentTransactionsGroup,
} from "./state-adapter-cases/add-jobs-blockers.ts";
import { closeGroup } from "./state-adapter-cases/close.ts";
import { completeJobsGroup } from "./state-adapter-cases/complete-jobs.ts";
import { continueJobsGroup } from "./state-adapter-cases/continue-jobs.ts";
import { countChainsByTypeNameGroup } from "./state-adapter-cases/count-chains-by-type-name.ts";
import { countJobsByTypeNameGroup } from "./state-adapter-cases/count-jobs-by-type-name.ts";
import { countRunningJobsByWorkerIdGroup } from "./state-adapter-cases/count-running-jobs-by-worker-id.ts";
import { countWorkersByTypeNameGroup } from "./state-adapter-cases/count-workers-by-type-name.ts";
import { countWorkersGroup } from "./state-adapter-cases/count-workers.ts";
import { createJobsGroup } from "./state-adapter-cases/create-jobs.ts";
import {
  deleteChainsGroup,
  deleteChainsConcurrentTransactionsGroup,
} from "./state-adapter-cases/delete-chains.ts";
import { extendWorkerLeaseGroup } from "./state-adapter-cases/extend-worker-lease.ts";
import { getChainTypeNamesGroup } from "./state-adapter-cases/get-chain-type-names.ts";
import {
  getChainsGroup,
  getChainsConcurrentTransactionsGroup,
} from "./state-adapter-cases/get-chains.ts";
import {
  getJobBlockersGroup,
  getJobBlockersConcurrentTransactionsGroup,
} from "./state-adapter-cases/get-job-blockers.ts";
import { getJobTypeNamesGroup } from "./state-adapter-cases/get-job-type-names.ts";
import {
  getJobsGroup,
  getJobsConcurrentTransactionsGroup,
} from "./state-adapter-cases/get-jobs.ts";
import {
  getStartAttemptDelayMsGroup,
  getStartAttemptDelayMsConcurrentTransactionsGroup,
} from "./state-adapter-cases/get-start-attempt-delay-ms.ts";
import { getWorkersGroup } from "./state-adapter-cases/get-workers.ts";
import { isTransactionGroup } from "./state-adapter-cases/is-transaction.ts";
import {
  listBlockedJobsGroup,
  listBlockedJobsConcurrentTransactionsGroup,
} from "./state-adapter-cases/list-blocked-jobs.ts";
import {
  listChainJobsGroup,
  listChainJobsConcurrentTransactionsGroup,
} from "./state-adapter-cases/list-chain-jobs.ts";
import {
  listChainsGroup,
  listChainsConcurrentTransactionsGroup,
} from "./state-adapter-cases/list-chains.ts";
import {
  listJobsGroup,
  listJobsConcurrentTransactionsGroup,
} from "./state-adapter-cases/list-jobs.ts";
import { listWorkerJobsGroup } from "./state-adapter-cases/list-worker-jobs.ts";
import { listWorkersGroup } from "./state-adapter-cases/list-workers.ts";
import { rescheduleJobsGroup } from "./state-adapter-cases/reschedule-jobs.ts";
import {
  type SchemaFenceConformanceFixture,
  schemaFenceConcurrentTransactionsGroup,
  schemaFenceGroup,
} from "./state-adapter-cases/schema-fence.ts";
import {
  startJobAttemptGroup,
  startJobAttemptConcurrentTransactionsGroup,
} from "./state-adapter-cases/start-job-attempt.ts";
import { startWorkerGroup } from "./state-adapter-cases/start-worker.ts";
import { stopWorkerGroup } from "./state-adapter-cases/stop-worker.ts";
import type { StateConformanceFixture } from "./state-adapter-cases/types.ts";
import {
  unblockJobsGroup,
  unblockJobsConcurrentTransactionsGroup,
} from "./state-adapter-cases/unblock-jobs.ts";
import {
  withTransactionGroup,
  withTransactionConcurrentTransactionsGroup,
} from "./state-adapter-cases/with-transaction.ts";

export { type StateConformanceFixture } from "./state-adapter-cases/types.ts";

export const stateAdapterBaseGroups: ConformanceGroup<StateConformanceFixture>[] = [
  withTransactionGroup,
  isTransactionGroup,
  getChainsGroup,
  getJobsGroup,
  getWorkersGroup,
  createJobsGroup,
  continueJobsGroup,
  addJobsBlockersGroup,
  getJobBlockersGroup,
  unblockJobsGroup,
  startWorkerGroup,
  extendWorkerLeaseGroup,
  stopWorkerGroup,
  startJobAttemptGroup,
  completeJobsGroup,
  getStartAttemptDelayMsGroup,
  rescheduleJobsGroup,
  deleteChainsGroup,
  getJobTypeNamesGroup,
  getChainTypeNamesGroup,
  countJobsByTypeNameGroup,
  countChainsByTypeNameGroup,
  countWorkersGroup,
  countWorkersByTypeNameGroup,
  countRunningJobsByWorkerIdGroup,
  listChainsGroup,
  listJobsGroup,
  listChainJobsGroup,
  listBlockedJobsGroup,
  listWorkersGroup,
  listWorkerJobsGroup,
  closeGroup,
];

export const stateAdapterConcurrentTransactionGroups: ConformanceGroup<StateConformanceFixture>[] =
  [
    withTransactionConcurrentTransactionsGroup,
    getChainsConcurrentTransactionsGroup,
    getJobsConcurrentTransactionsGroup,
    addJobsBlockersConcurrentTransactionsGroup,
    getJobBlockersConcurrentTransactionsGroup,
    unblockJobsConcurrentTransactionsGroup,
    startJobAttemptConcurrentTransactionsGroup,
    getStartAttemptDelayMsConcurrentTransactionsGroup,
    deleteChainsConcurrentTransactionsGroup,
    listChainsConcurrentTransactionsGroup,
    listJobsConcurrentTransactionsGroup,
    listChainJobsConcurrentTransactionsGroup,
    listBlockedJobsConcurrentTransactionsGroup,
  ];

export { type SchemaFenceConformanceFixture } from "./state-adapter-cases/schema-fence.ts";

/**
 * Cases for adapters that fence writes behind a schema fence table, such as the PostgreSQL and
 * SQLite adapters. Internal for now: the fence is not part of the public state adapter contract.
 */
export const stateAdapterSchemaFenceGroups: ConformanceGroup<SchemaFenceConformanceFixture>[] = [
  schemaFenceGroup,
];

/** The schema fence cases that hold two transactions open at once. */
export const stateAdapterSchemaFenceConcurrentTransactionGroups: ConformanceGroup<SchemaFenceConformanceFixture>[] =
  [schemaFenceConcurrentTransactionsGroup];
