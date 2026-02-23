import { type JobChain } from "../entities/job-chain.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type CommitHooks } from "../commit-hooks.js";
import { bufferNotifyJobScheduled } from "../helpers/notify-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import {
  type BaseTxContext,
  type DeduplicationOptions,
  type StateJob,
} from "../state-adapter/state-adapter.js";

export const createStateJob = async (
  helpers: Helpers,
  {
    typeName,
    input,
    txCtx,
    commitHooks,
    blockers,
    isChain,
    chainId,
    chainIndex,
    chainTypeName,
    originTraceContext,
    deduplication,
    schedule,
  }: {
    typeName: string;
    input: unknown;
    txCtx: BaseTxContext;
    commitHooks: CommitHooks;
    blockers?: JobChain<any, any, any, any>[];
    isChain: boolean;
    chainId?: string;
    chainIndex: number;
    chainTypeName?: string;
    originTraceContext?: unknown;
    deduplication?: DeduplicationOptions;
    schedule?: ScheduleOptions;
  },
): Promise<{ job: StateJob; deduplicated: boolean }> => {
  if (isChain) {
    helpers.registry.validateEntry(typeName);
  }

  const parsedInput = helpers.registry.parseInput(typeName, input);

  const resolvedChainTypeName = isChain ? typeName : chainTypeName!;

  const spanHandle = helpers.observabilityHelper.startJobSpan({
    chainTypeName: resolvedChainTypeName,
    jobTypeName: typeName,
    isChainStart: isChain,
    originTraceContext: isChain ? undefined : originTraceContext,
  });

  let createJobResult: { job: StateJob; deduplicated: boolean };
  try {
    createJobResult = await helpers.stateAdapter.createJob({
      txCtx,
      typeName,
      chainTypeName: resolvedChainTypeName,
      chainIndex,
      input: parsedInput,
      chainId: isChain ? undefined : chainId,
      deduplication,
      schedule,
      traceContext: spanHandle?.getTraceContext(),
    });
  } catch (error) {
    spanHandle?.end({ status: "error", error });
    throw error;
  }

  let job = createJobResult.job;
  const deduplicated = createJobResult.deduplicated;

  if (deduplicated) {
    spanHandle?.end({
      status: "deduplicated",
      chainId: job.chainId,
      jobId: job.id,
      existingTraceContext: job.traceContext,
    });
    return { job, deduplicated };
  }

  let blockerChains: JobChain<any, any, any, any>[] = [];
  let incompleteBlockerChainIds: string[] = [];
  if (blockers && blockers.length > 0) {
    blockerChains = blockers;
    const blockerChainIds = blockerChains.map((b) => b.id);

    const blockerSpanHandles = blockerChains.map((blocker, i) =>
      helpers.observabilityHelper.startBlockerSpan({
        chainId: job.chainId,
        chainTypeName: resolvedChainTypeName,
        jobId: job.id,
        jobTypeName: typeName,
        jobTraceContext: spanHandle?.getTraceContext(),
        blockerChainId: blocker.id,
        blockerChainTypeName: blocker.typeName,
        blockerIndex: i,
      }),
    );

    const addBlockersResult = await helpers.stateAdapter.addJobBlockers({
      txCtx,
      jobId: job.id,
      blockedByChainIds: blockerChainIds,
      blockerTraceContexts: blockerSpanHandles.map((h) => h?.getTraceContext() ?? null),
    });
    job = addBlockersResult.job;
    incompleteBlockerChainIds = addBlockersResult.incompleteBlockerChainIds;

    const incompleteSet = new Set(incompleteBlockerChainIds);
    blockerSpanHandles.forEach((handle, i) => {
      if (!handle) return;
      handle.end({ blockerTraceContext: addBlockersResult.blockerChainTraceContexts[i] });
      if (!incompleteSet.has(blockerChainIds[i])) {
        helpers.observabilityHelper.completeBlockerSpan({
          traceContext: handle.getTraceContext(),
          blockerChainTypeName: blockerChains[i].typeName,
        });
      }
    });
  }

  const blockerRefs = blockerChains.map((b) => ({ typeName: b.typeName, input: b.input }));
  helpers.registry.validateBlockers(typeName, blockerRefs);

  spanHandle?.end({
    status: "created",
    chainId: job.chainId,
    jobId: job.id,
  });

  if (isChain) {
    helpers.observabilityHelper.jobChainCreated(job, { input });
  }

  helpers.observabilityHelper.jobCreated(job, { input, blockers: blockerChains, schedule });

  if (incompleteBlockerChainIds.length > 0) {
    const incompleteBlockerSet = new Set(incompleteBlockerChainIds);
    const incompleteBlockerChains = blockerChains.filter((b) => incompleteBlockerSet.has(b.id));
    helpers.observabilityHelper.jobBlocked(job, { blockedByChains: incompleteBlockerChains });
  }

  bufferNotifyJobScheduled(commitHooks, helpers.notifyAdapter, job);

  return { job, deduplicated };
};
