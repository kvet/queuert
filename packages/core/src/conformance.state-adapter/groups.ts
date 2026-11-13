import type { ConformanceGroup } from "../conformance/runner.ts";
import {
  addJobsBlockersGroup,
  addJobsBlockersConcurrentTransactionsGroup,
} from "./cases/add-jobs-blockers.ts";
import { closeGroup } from "./cases/close.ts";
import { completeJobsGroup } from "./cases/complete-jobs.ts";
import { continueJobsGroup } from "./cases/continue-jobs.ts";
import { countCapGroup } from "./cases/count-cap.ts";
import { countChainsByTypeNameGroup } from "./cases/count-chains-by-type-name.ts";
import { countJobsByTypeNameGroup } from "./cases/count-jobs-by-type-name.ts";
import { countRunningJobsByWorkerIdGroup } from "./cases/count-running-jobs-by-worker-id.ts";
import { countWorkersByTypeNameGroup } from "./cases/count-workers-by-type-name.ts";
import { countWorkersGroup } from "./cases/count-workers.ts";
import { createJobsGroup } from "./cases/create-jobs.ts";
import {
  deleteChainsGroup,
  deleteChainsConcurrentTransactionsGroup,
} from "./cases/delete-chains.ts";
import {
  extendWorkerLeaseGroup,
  extendWorkerLeaseConcurrentTransactionsGroup,
} from "./cases/extend-worker-lease.ts";
import { getChainTypeNamesGroup } from "./cases/get-chain-type-names.ts";
import { getChainsGroup, getChainsConcurrentTransactionsGroup } from "./cases/get-chains.ts";
import {
  getJobBlockersGroup,
  getJobBlockersConcurrentTransactionsGroup,
} from "./cases/get-job-blockers.ts";
import { getJobTypeNamesGroup } from "./cases/get-job-type-names.ts";
import { getJobsGroup, getJobsConcurrentTransactionsGroup } from "./cases/get-jobs.ts";
import {
  getStartAttemptDelayMsGroup,
  getStartAttemptDelayMsConcurrentTransactionsGroup,
} from "./cases/get-start-attempt-delay-ms.ts";
import { getWorkersGroup } from "./cases/get-workers.ts";
import { isTransactionGroup } from "./cases/is-transaction.ts";
import {
  listBlockedJobsGroup,
  listBlockedJobsConcurrentTransactionsGroup,
} from "./cases/list-blocked-jobs.ts";
import {
  listChainJobsGroup,
  listChainJobsConcurrentTransactionsGroup,
} from "./cases/list-chain-jobs.ts";
import { listChainsGroup, listChainsConcurrentTransactionsGroup } from "./cases/list-chains.ts";
import { listJobsGroup, listJobsConcurrentTransactionsGroup } from "./cases/list-jobs.ts";
import { listWorkerJobsGroup } from "./cases/list-worker-jobs.ts";
import { listWorkersGroup } from "./cases/list-workers.ts";
import { rescheduleJobsGroup } from "./cases/reschedule-jobs.ts";
import { schemaFenceConcurrentTransactionsGroup, schemaFenceGroup } from "./cases/schema-fence.ts";
import {
  startJobAttemptGroup,
  startJobAttemptConcurrentTransactionsGroup,
} from "./cases/start-job-attempt.ts";
import { startWorkerGroup } from "./cases/start-worker.ts";
import { stopWorkerGroup } from "./cases/stop-worker.ts";
import { txCallbacksGroup, txCallbacksSavepointGroup } from "./cases/tx-callbacks.ts";
import { unblockJobsGroup, unblockJobsConcurrentTransactionsGroup } from "./cases/unblock-jobs.ts";
import {
  withTransactionGroup,
  withTransactionConcurrentTransactionsGroup,
} from "./cases/with-transaction.ts";
import type {
  SavepointConformanceContext,
  SchemaFenceConformanceContext,
  StateAdapterConformanceContext,
} from "./types.ts";

export const stateAdapterBaseGroups: ConformanceGroup<StateAdapterConformanceContext>[] = [
  withTransactionGroup,
  isTransactionGroup,
  txCallbacksGroup,
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

export const stateAdapterConcurrentTransactionGroups: ConformanceGroup<StateAdapterConformanceContext>[] =
  [
    withTransactionConcurrentTransactionsGroup,
    getChainsConcurrentTransactionsGroup,
    getJobsConcurrentTransactionsGroup,
    addJobsBlockersConcurrentTransactionsGroup,
    getJobBlockersConcurrentTransactionsGroup,
    unblockJobsConcurrentTransactionsGroup,
    extendWorkerLeaseConcurrentTransactionsGroup,
    startJobAttemptConcurrentTransactionsGroup,
    getStartAttemptDelayMsConcurrentTransactionsGroup,
    deleteChainsConcurrentTransactionsGroup,
    listChainsConcurrentTransactionsGroup,
    listJobsConcurrentTransactionsGroup,
    listChainJobsConcurrentTransactionsGroup,
    listBlockedJobsConcurrentTransactionsGroup,
  ];

/**
 * Cases for adapters that fence writes behind a schema fence table, such as the PostgreSQL and
 * SQLite adapters. Internal for now: the fence is not part of the public state adapter contract.
 */
export const stateAdapterSchemaFenceGroups: ConformanceGroup<SchemaFenceConformanceContext>[] = [
  schemaFenceGroup,
];

/** The schema fence cases that hold two transactions open at once. */
export const stateAdapterSchemaFenceConcurrentTransactionGroups: ConformanceGroup<SchemaFenceConformanceContext>[] =
  [schemaFenceConcurrentTransactionsGroup];

/**
 * Cases that check the counts stop at `config.countCap`, for an adapter created with a small
 * `countCap`. Internal: at the default cap they would create over 20,000 jobs.
 */
export const stateAdapterCountCapGroups: ConformanceGroup<StateAdapterConformanceContext>[] = [
  countCapGroup,
];

/** The cases that need a savepoint of an open transaction. */
export const stateAdapterSavepointGroups: ConformanceGroup<SavepointConformanceContext>[] = [
  txCallbacksSavepointGroup,
];
