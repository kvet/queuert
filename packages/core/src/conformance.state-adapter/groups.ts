import type { ConformanceGroup } from "../conformance/runner.ts";
import {
  addJobsBlockersGroup,
  addJobsBlockersConcurrentTransactionsGroup,
  addJobsBlockersNonLockingReadsGroup,
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
import {
  getChainsGroup,
  getChainsHeldTransactionGroup,
  getChainsConcurrentTransactionsGroup,
} from "./cases/get-chains.ts";
import {
  getJobBlockersGroup,
  getJobBlockersConcurrentTransactionsGroup,
} from "./cases/get-job-blockers.ts";
import { getJobTypeNamesGroup } from "./cases/get-job-type-names.ts";
import {
  getJobsGroup,
  getJobsHeldTransactionGroup,
  getJobsConcurrentTransactionsGroup,
} from "./cases/get-jobs.ts";
import {
  getStartAttemptDelayMsGroup,
  getStartAttemptDelayMsConcurrentTransactionsGroup,
} from "./cases/get-start-attempt-delay-ms.ts";
import { getWorkersGroup, getWorkersHeldTransactionGroup } from "./cases/get-workers.ts";
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
  startJobAttemptHeldTransactionGroup,
  startJobAttemptConcurrentTransactionsGroup,
  startJobAttemptNonLockingReadsGroup,
  startJobAttemptGapLockFreeGroup,
} from "./cases/start-job-attempt.ts";
import { startWorkerGroup } from "./cases/start-worker.ts";
import { stopWorkerGroup } from "./cases/stop-worker.ts";
import {
  txCallbacksAsyncCallbackGroup,
  txCallbacksGroup,
  txCallbacksSavepointGroup,
} from "./cases/tx-callbacks.ts";
import { unblockJobsGroup, unblockJobsConcurrentTransactionsGroup } from "./cases/unblock-jobs.ts";
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

export const stateAdapterAsyncGroups: ConformanceGroup<StateAdapterConformanceContext>[] = [
  withTransactionHeldTransactionGroup,
  txCallbacksAsyncCallbackGroup,
  getChainsHeldTransactionGroup,
  getJobsHeldTransactionGroup,
  getWorkersHeldTransactionGroup,
  startJobAttemptHeldTransactionGroup,
];

export const stateAdapterNonLockingReadGroups: ConformanceGroup<StateAdapterConformanceContext>[] =
  [addJobsBlockersNonLockingReadsGroup, startJobAttemptNonLockingReadsGroup];

export const stateAdapterGapLockFreeGroups: ConformanceGroup<StateAdapterConformanceContext>[] = [
  startJobAttemptGapLockFreeGroup,
];

export const stateAdapterConcurrentTransactionGroups: ConformanceGroup<StateAdapterConformanceContext>[] =
  [
    ...stateAdapterNonLockingReadGroups,
    ...stateAdapterGapLockFreeGroups,
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
