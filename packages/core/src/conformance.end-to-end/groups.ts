import type { NotifyAdapterConformanceContext } from "../conformance.notify-adapter/types.ts";
import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../conformance/runner.ts";
import {
  type InProcessContext,
  createInProcessStateAdapter,
} from "../state-adapter/state-adapter.in-process.ts";
import { awaitChainGroup } from "./cases/await-chain.ts";
import {
  blockerChainsConcurrentTransactionsGroup,
  blockerChainsGroup,
} from "./cases/blocker-chains.ts";
import { chainsGroup } from "./cases/chains.ts";
import { clientQueriesGroup } from "./cases/client-queries.ts";
import { createChainsGroup, createChainsNotifyGroup } from "./cases/create-chains.ts";
import { deduplicationGroup } from "./cases/deduplication.ts";
import { deletionGroup, deletionNotifyGroup } from "./cases/deletion.ts";
import { notifyResilienceGroup } from "./cases/notify-resilience.ts";
import { notifyGroup } from "./cases/notify.ts";
import {
  processErrorHandlingGroup,
  processErrorHandlingPoisonTransactionGroup,
} from "./cases/process-error-handling.ts";
import { processGroup, processNotifyGroup, processSavepointGroup } from "./cases/process.ts";
import { rescheduleJobGroup } from "./cases/reschedule-job.ts";
import { schedulingGroup } from "./cases/scheduling.ts";
import {
  stateResilienceConcurrentTransactionsGroup,
  stateResilienceFlakyDbConcurrentTransactionsGroup,
  stateResilienceFlakyDbGroup,
  stateResilienceGroup,
} from "./cases/state-resilience.ts";
import { validationGroup } from "./cases/validation.ts";
import { workerGroup } from "./cases/worker.ts";
import {
  workerlessCompletionConcurrentTransactionsGroup,
  workerlessCompletionGroup,
} from "./cases/workerless-completion.ts";
import type {
  EndToEndFlakyDbContext,
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
  workerlessCompletionGroup,
  rescheduleJobGroup,
  schedulingGroup,
  validationGroup,
  clientQueriesGroup,
  processGroup,
  processErrorHandlingGroup,
  workerGroup,
  stateResilienceGroup,
];

export const endToEndNotifyGroups: ConformanceGroup<StateAdapterConformanceContext>[] = [
  createChainsNotifyGroup,
  deletionNotifyGroup,
  processNotifyGroup,
  notifyGroup,
  notifyResilienceGroup,
];

export const endToEndConcurrentTransactionGroups: ConformanceGroup<StateAdapterConformanceContext>[] =
  [
    blockerChainsConcurrentTransactionsGroup,
    workerlessCompletionConcurrentTransactionsGroup,
    stateResilienceConcurrentTransactionsGroup,
  ];

export const endToEndSavepointGroups: ConformanceGroup<EndToEndSavepointContext>[] = [
  processSavepointGroup,
];

export const endToEndPoisonTransactionGroups: ConformanceGroup<EndToEndPoisonTransactionContext>[] =
  [processErrorHandlingPoisonTransactionGroup];

export const endToEndFlakyDbGroups: ConformanceGroup<EndToEndFlakyDbContext>[] = [
  stateResilienceFlakyDbGroup,
];

export const endToEndFlakyDbConcurrentTransactionGroups: ConformanceGroup<EndToEndFlakyDbContext>[] =
  [stateResilienceFlakyDbConcurrentTransactionsGroup];

const nonTransactionContext: Omit<InProcessContext, "txHooks"> = { inTransaction: false };

export const notifyAdapterEndToEndGroups: ConformanceGroup<NotifyAdapterConformanceContext>[] =
  endToEndNotifyGroups.map((group) => ({
    name: group.name,
    cases: group.cases.map((testCase) => ({
      name: testCase.name,
      run: async ({ createNotifyAdapter }) =>
        testCase.run({
          createStateAdapter: async () => createInProcessStateAdapter(),
          withNonTransactionContext: async (fn) => fn(nonTransactionContext),
          createNotifyAdapter,
        }),
    })),
  }));
