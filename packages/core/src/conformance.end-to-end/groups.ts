import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../conformance/runner.ts";
import {
  applyJobOutcomesConcurrentTransactionsGroup,
  applyJobOutcomesGroup,
  applyJobOutcomesNotifyConcurrentTransactionsGroup,
  applyJobOutcomesSavepointGroup,
} from "./cases/apply-job-outcomes.ts";
import { awaitChainGroup } from "./cases/await-chain.ts";
import {
  blockerChainsConcurrentTransactionsGroup,
  blockerChainsGroup,
  blockerChainsNotifyConcurrentTransactionsGroup,
} from "./cases/blocker-chains.ts";
import { chainsGroup } from "./cases/chains.ts";
import {
  clientQueriesGroup,
  clientQueriesLockedReadsConcurrentTransactionsLockWaitGroup,
  clientQueriesLockedReadsGroup,
  clientQueriesLockedReadsSavepointGroup,
} from "./cases/client-queries.ts";
import { createChainsGroup, createChainsNotifyGroup } from "./cases/create-chains.ts";
import { deduplicationGroup } from "./cases/deduplication.ts";
import {
  deletionAsyncGroup,
  deletionConcurrentTransactionsGroup,
  deletionConcurrentTransactionsLockWaitGroup,
  deletionGroup,
  deletionNotifyConcurrentTransactionsGroup,
  deletionNotifyGroup,
} from "./cases/deletion.ts";
import { notifyResilienceGroup } from "./cases/notify-resilience.ts";
import { notifyGroup } from "./cases/notify.ts";
import {
  processErrorHandlingGroup,
  processErrorHandlingPoisonTransactionGroup,
} from "./cases/process-error-handling.ts";
import {
  processAsyncGroup,
  processGroup,
  processNotifyGroup,
  processSavepointGroup,
} from "./cases/process.ts";
import { schedulingGroup } from "./cases/scheduling.ts";
import {
  stateResilienceConcurrentTransactionsGroup,
  stateResilienceFlakyDbConcurrentTransactionsGroup,
  stateResilienceFlakyDbGroup,
  stateResilienceGroup,
} from "./cases/state-resilience.ts";
import { validationGroup } from "./cases/validation.ts";
import { workerGroup } from "./cases/worker.ts";
import type {
  EndToEndFlakyDbContext,
  EndToEndNotifyContext,
  EndToEndPoisonTransactionContext,
  EndToEndSavepointContext,
} from "./types.ts";

export const endToEndBaseGroups: ConformanceGroup<StateAdapterConformanceContext>[] = [
  chainsGroup,
  createChainsGroup,
  blockerChainsGroup,
  deduplicationGroup,
  deletionGroup,
  awaitChainGroup,
  applyJobOutcomesGroup,
  schedulingGroup,
  validationGroup,
  clientQueriesGroup,
  clientQueriesLockedReadsGroup,
  processGroup,
  processErrorHandlingGroup,
  workerGroup,
  stateResilienceGroup,
];

export const endToEndAsyncGroups: ConformanceGroup<StateAdapterConformanceContext>[] = [
  processAsyncGroup,
  deletionAsyncGroup,
];

export const endToEndNotifyGroups: ConformanceGroup<EndToEndNotifyContext>[] = [
  createChainsNotifyGroup,
  deletionNotifyGroup,
  processNotifyGroup,
  notifyGroup,
  notifyResilienceGroup,
];

export const endToEndConcurrentTransactionGroups: ConformanceGroup<StateAdapterConformanceContext>[] =
  [
    blockerChainsConcurrentTransactionsGroup,
    deletionConcurrentTransactionsGroup,
    applyJobOutcomesConcurrentTransactionsGroup,
    stateResilienceConcurrentTransactionsGroup,
  ];

export const endToEndNotifyConcurrentTransactionGroups: ConformanceGroup<StateAdapterConformanceContext>[] =
  [
    blockerChainsNotifyConcurrentTransactionsGroup,
    deletionNotifyConcurrentTransactionsGroup,
    applyJobOutcomesNotifyConcurrentTransactionsGroup,
  ];

export const endToEndConcurrentTransactionLockWaitGroups: ConformanceGroup<StateAdapterConformanceContext>[] =
  [
    clientQueriesLockedReadsConcurrentTransactionsLockWaitGroup,
    deletionConcurrentTransactionsLockWaitGroup,
  ];

export const endToEndSavepointGroups: ConformanceGroup<EndToEndSavepointContext>[] = [
  processSavepointGroup,
  applyJobOutcomesSavepointGroup,
  clientQueriesLockedReadsSavepointGroup,
];

export const endToEndPoisonTransactionGroups: ConformanceGroup<EndToEndPoisonTransactionContext>[] =
  [processErrorHandlingPoisonTransactionGroup];

export const endToEndFlakyDbGroups: ConformanceGroup<EndToEndFlakyDbContext>[] = [
  stateResilienceFlakyDbGroup,
];

export const endToEndFlakyDbConcurrentTransactionGroups: ConformanceGroup<EndToEndFlakyDbContext>[] =
  [stateResilienceFlakyDbConcurrentTransactionsGroup];
