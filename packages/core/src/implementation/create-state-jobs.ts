import { type Chain } from "../entities/chain.js";
import { type DeduplicationOptions } from "../entities/deduplication.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { bufferNotifyJobScheduled } from "../helpers/notify-hooks.js";
import {
  bufferObservabilityEvent,
  bufferObservabilityRollback,
} from "../helpers/observability-hooks.js";
import { type Helpers } from "../setup-helpers.js";
import { type BaseTxContext, type StateJob } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

type CreateStateJobInput = {
  id?: string;
  typeName: string;
  input: unknown;
  blockers?: Chain<any, any, any, any>[];
  schedule?: ScheduleOptions;
} & (
  | {
      chainTypeName: string;
      deduplication?: DeduplicationOptions<string>;
    }
  | {
      fromJob: StateJob;
    }
);

const isChainStart = <T extends { chainTypeName: string } | { fromJob: StateJob }>(
  job: T,
): job is Extract<T, { chainTypeName: string }> => "chainTypeName" in job;

export const createStateJobs = async (
  helpers: Helpers,
  {
    jobs: jobInputs,
    txCtx,
    transactionHooks,
  }: {
    jobs: CreateStateJobInput[];
    txCtx: BaseTxContext;
    transactionHooks: TransactionHooks;
  },
): Promise<{ job: StateJob; deduplicated: boolean }[]> => {
  if (jobInputs.length === 0) return [];

  const parsed = jobInputs.map((jobInput) => {
    const parsedInput = helpers.jobTypes.parseInput(jobInput.typeName, jobInput.input);
    return { ...jobInput, parsedInput };
  });

  const spanHandles = parsed.map((jobInput) => {
    const chainStart = isChainStart(jobInput);
    return helpers.observabilityHelper.startJobSpan({
      chainTypeName: chainStart ? jobInput.chainTypeName : jobInput.fromJob.chainTypeName,
      jobTypeName: jobInput.typeName,
      isChainStart: chainStart,
      originChainTraceContext: chainStart ? undefined : jobInput.fromJob.chainTraceContext,
      originTraceContext: chainStart ? undefined : jobInput.fromJob.traceContext,
    });
  });

  const createJobParams = parsed.map((jobInput, i) => {
    const common = {
      id: jobInput.id,
      typeName: jobInput.typeName,
      input: jobInput.parsedInput,
      schedule: jobInput.schedule,
      chainTraceContext: spanHandles[i]?.getChainTraceContext() ?? null,
      traceContext: spanHandles[i]?.getTraceContext() ?? null,
    };
    if (isChainStart(jobInput)) {
      return {
        ...common,
        chainTypeName: jobInput.chainTypeName,
        deduplication: jobInput.deduplication,
      };
    }
    return {
      ...common,
      continueFromJobId: jobInput.fromJob.id,
    };
  });

  let createResults: { job: StateJob; deduplicated: boolean }[];
  try {
    createResults = await helpers.stateAdapter.createJobs({ txCtx, jobs: createJobParams });
  } catch (error) {
    for (const spanHandle of spanHandles) {
      spanHandle?.end({ status: "error", error });
    }
    throw error;
  }

  try {
    const jobs: StateJob[] = createResults.map((r) => r.job);
    const perJobIncompleteBlockerChainIds: string[][] = parsed.map(() => []);

    for (let i = 0; i < createResults.length; i++) {
      if (createResults[i].deduplicated) {
        spanHandles[i]?.end({
          status: "deduplicated",
          chainId: jobs[i].chainId,
          jobId: jobs[i].id,
          existingChainTraceContext: jobs[i].chainTraceContext,
        });
      }
    }

    const blockerIndices: number[] = [];
    const blockerSpanHandlesPerEntry: ReturnType<
      typeof helpers.observabilityHelper.startBlockerSpan
    >[][] = [];

    for (let i = 0; i < parsed.length; i++) {
      if (createResults[i].deduplicated) continue;
      const blockers = parsed[i].blockers;
      if (!blockers || blockers.length === 0) continue;

      blockerIndices.push(i);
      blockerSpanHandlesPerEntry.push(
        spanHandles[i]
          ? blockers.map((blocker, bi) =>
              helpers.observabilityHelper.startBlockerSpan({
                chainId: jobs[i].chainId,
                chainTypeName: jobs[i].chainTypeName,
                jobId: jobs[i].id,
                jobTypeName: parsed[i].typeName,
                jobTraceContext: spanHandles[i]!.getTraceContext(),
                blockerChainId: blocker.id,
                blockerChainTypeName: blocker.typeName,
                blockerIndex: bi,
              }),
            )
          : [],
      );
    }

    if (blockerIndices.length > 0) {
      const blockerParams = blockerIndices.map((i, bi) => ({
        jobId: jobs[i].id,
        blockedByChainIds: parsed[i].blockers!.map((b) => b.id),
        blockerTraceContexts: blockerSpanHandlesPerEntry[bi].map(
          (h) => h?.getTraceContext() ?? null,
        ),
      }));

      const blockerResults = await helpers.stateAdapter.addJobsBlockers({
        txCtx,
        jobBlockers: blockerParams,
      });

      for (let bi = 0; bi < blockerIndices.length; bi++) {
        const i = blockerIndices[bi];
        const result = blockerResults[bi];
        const blockerChains = parsed[i].blockers!;
        const blockerChainIds = blockerChains.map((b) => b.id);
        const blockerSpanHandlesList = blockerSpanHandlesPerEntry[bi];

        jobs[i] = result.job;
        perJobIncompleteBlockerChainIds[i] = result.incompleteBlockerChainIds;

        const incompleteSet = new Set(result.incompleteBlockerChainIds);
        blockerSpanHandlesList.forEach((handle, hi) => {
          if (!handle) return;
          bufferObservabilityEvent(transactionHooks, () => {
            handle.end({
              blockerChainTraceContext: result.blockerChainTraceContexts[hi],
            });
          });
          if (!incompleteSet.has(blockerChainIds[hi])) {
            bufferObservabilityEvent(transactionHooks, () => {
              helpers.observabilityHelper.completeBlockerSpan({
                traceContext: handle.getTraceContext(),
                blockerChainTypeName: blockerChains[hi].typeName,
              });
            });
          }
        });
      }
    }

    for (let i = 0; i < parsed.length; i++) {
      if (createResults[i].deduplicated) continue;

      const job = jobs[i];
      const jobInput = parsed[i];
      const blockerChains = jobInput.blockers ?? [];

      const blockerRefs = blockerChains.map((b) => ({ typeName: b.typeName, input: b.input }));
      helpers.jobTypes.validateBlockers(jobInput.typeName, blockerRefs);

      bufferObservabilityEvent(transactionHooks, () =>
        spanHandles[i]?.end({ status: "created", chainId: job.chainId, jobId: job.id }),
      );

      if (spanHandles[i]) {
        bufferObservabilityRollback(transactionHooks, () => {
          spanHandles[i]!.end({ status: "error", error: new Error("savepoint rolled back") });
        });
      }

      if (isChainStart(jobInput)) {
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.chainCreated(job, { input: jobInput.input });
        });
      }

      bufferObservabilityEvent(transactionHooks, () => {
        helpers.observabilityHelper.jobCreated(job, {
          input: jobInput.input,
          blockers: blockerChains,
          schedule: jobInput.schedule,
        });
      });

      const incompleteBlockerChainIds = perJobIncompleteBlockerChainIds[i];
      if (incompleteBlockerChainIds.length > 0) {
        const incompleteBlockerSet = new Set(incompleteBlockerChainIds);
        const incompleteBlockerChains = blockerChains.filter((b) => incompleteBlockerSet.has(b.id));
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.jobBlocked(job, {
            blockedByChains: incompleteBlockerChains,
          });
        });
      }

      bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, job);
    }

    return parsed.map((_, i) => ({
      job: jobs[i],
      deduplicated: createResults[i].deduplicated,
    }));
  } catch (error) {
    for (let i = 0; i < spanHandles.length; i++) {
      if (!createResults![i]?.deduplicated) {
        spanHandles[i]?.end({ status: "error", error });
      }
    }
    throw error;
  }
};
