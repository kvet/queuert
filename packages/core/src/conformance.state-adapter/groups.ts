import type { ConformanceGroup } from "../conformance/runner.ts";
import {
  addJobsBlockersGroup,
  addJobsBlockersConcurrentTransactionsGroup,
  addJobsBlockersConcurrentTransactionsLockWaitGroup,
} from "./cases/add-jobs-blockers.ts";
import { closeGroup } from "./cases/close.ts";
import {
  completeJobsGroup,
  completeJobsHeldTransactionLockWaitGroup,
} from "./cases/complete-jobs.ts";
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
  deleteChainsConcurrentTransactionsLockWaitGroup,
} from "./cases/delete-chains.ts";
import {
  extendWorkerLeaseGroup,
  extendWorkerLeaseConcurrentTransactionsGroup,
} from "./cases/extend-worker-lease.ts";
import {
  getChainTailsGroup,
  getChainTailsHeldTransactionLockWaitGroup,
  getChainTailsConcurrentTransactionsLockWaitGroup,
} from "./cases/get-chain-tails.ts";
import { getChainTypeNamesGroup } from "./cases/get-chain-type-names.ts";
import {
  getChainsGroup,
  getChainsHeldTransactionLockWaitGroup,
  getChainsConcurrentTransactionsGroup,
} from "./cases/get-chains.ts";
import { getJobTypeNamesGroup } from "./cases/get-job-type-names.ts";
import {
  getJobsBlockersGroup,
  getJobsBlockersConcurrentTransactionsGroup,
} from "./cases/get-jobs-blockers.ts";
import {
  getJobsGroup,
  getJobsHeldTransactionLockWaitGroup,
  getJobsConcurrentTransactionsGroup,
  getJobsConcurrentTransactionsLockWaitGroup,
} from "./cases/get-jobs.ts";
import {
  getStartAttemptDelayMsGroup,
  getStartAttemptDelayMsConcurrentTransactionsGroup,
} from "./cases/get-start-attempt-delay-ms.ts";
import { getTransactionGroup } from "./cases/get-transaction.ts";
import {
  getWorkersGroup,
  getWorkersHeldTransactionGroup,
  getWorkersHeldTransactionLockWaitGroup,
} from "./cases/get-workers.ts";
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
  startJobAttemptHeldTransactionGroup,
  startJobAttemptHeldTransactionLockWaitGroup,
  startJobAttemptConcurrentTransactionsGroup,
} from "./cases/start-job-attempt.ts";
import { startWorkerGroup } from "./cases/start-worker.ts";
import { stopWorkerGroup } from "./cases/stop-worker.ts";
import {
  txCallbacksAsyncCallbackGroup,
  txCallbacksGroup,
  txCallbacksSavepointGroup,
} from "./cases/tx-callbacks.ts";
import {
  unblockJobsGroup,
  unblockJobsConcurrentTransactionsGroup,
  unblockJobsConcurrentTransactionsLockWaitGroup,
} from "./cases/unblock-jobs.ts";
import {
  withTransactionGroup,
  withTransactionHeldTransactionGroup,
  withTransactionConcurrentTransactionsGroup,
} from "./cases/with-transaction.ts";
import type {
  SavepointConformanceContext,
  SchemaFenceConformanceContext,
  StateAdapterConformanceContext,
} from "./types.ts";

export const stateAdapterBaseGroups: ConformanceGroup<StateAdapterConformanceContext>[] = [
  withTransactionGroup,
  getTransactionGroup,
  txCallbacksGroup,
  getChainsGroup,
  getChainTailsGroup,
  getJobsGroup,
  getWorkersGroup,
  createJobsGroup,
  continueJobsGroup,
  addJobsBlockersGroup,
  getJobsBlockersGroup,
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

export const stateAdapterAsyncGroups: ConformanceGroup<StateAdapterConformanceContext>[] = [
  withTransactionHeldTransactionGroup,
  txCallbacksAsyncCallbackGroup,
  getWorkersHeldTransactionGroup,
  startJobAttemptHeldTransactionGroup,
];

export const stateAdapterAsyncLockWaitGroups: ConformanceGroup<StateAdapterConformanceContext>[] = [
  getChainsHeldTransactionLockWaitGroup,
  getChainTailsHeldTransactionLockWaitGroup,
  getJobsHeldTransactionLockWaitGroup,
  completeJobsHeldTransactionLockWaitGroup,
  getWorkersHeldTransactionLockWaitGroup,
  startJobAttemptHeldTransactionLockWaitGroup,
];

export const stateAdapterConcurrentTransactionGroups: ConformanceGroup<StateAdapterConformanceContext>[] =
  [
    withTransactionConcurrentTransactionsGroup,
    getChainsConcurrentTransactionsGroup,
    getJobsConcurrentTransactionsGroup,
    addJobsBlockersConcurrentTransactionsGroup,
    getJobsBlockersConcurrentTransactionsGroup,
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

export const stateAdapterConcurrentTransactionLockWaitGroups: ConformanceGroup<StateAdapterConformanceContext>[] =
  [
    getChainTailsConcurrentTransactionsLockWaitGroup,
    getJobsConcurrentTransactionsLockWaitGroup,
    addJobsBlockersConcurrentTransactionsLockWaitGroup,
    unblockJobsConcurrentTransactionsLockWaitGroup,
    deleteChainsConcurrentTransactionsLockWaitGroup,
  ];

export const stateAdapterSchemaFenceGroups: ConformanceGroup<SchemaFenceConformanceContext>[] = [
  schemaFenceGroup,
];

export const stateAdapterSchemaFenceConcurrentTransactionGroups: ConformanceGroup<SchemaFenceConformanceContext>[] =
  [schemaFenceConcurrentTransactionsGroup];

export const stateAdapterCountCapGroups: ConformanceGroup<StateAdapterConformanceContext>[] = [
  countCapGroup,
];

export const stateAdapterSavepointGroups: ConformanceGroup<SavepointConformanceContext>[] = [
  txCallbacksSavepointGroup,
];
