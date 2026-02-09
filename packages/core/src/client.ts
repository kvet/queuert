import { type JobTypeRegistry } from "./entities/job-type-registry.js";
import {
  type BaseJobTypeDefinitions,
  type ChainJobTypes,
  type ChainJobs,
  type ContinuationJobs,
  type EntryJobTypeDefinitions,
  type HasBlockers,
  type JobChainOf,
  type JobOf,
} from "./entities/job-type.js";
import { type ScheduleOptions } from "./entities/schedule.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { type Log } from "./observability-adapter/log.js";
import { type ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import { type StartBlockersFn, helper } from "./helper.js";
import {
  type BaseTxContext,
  type DeduplicationOptions,
  type GetStateAdapterJobId,
  type GetStateAdapterTxContext,
  type StateAdapter,
  type StateJob,
} from "./state-adapter/state-adapter.js";

import {
  type CompletedJobChain,
  type JobChain,
  mapStateJobPairToJobChain,
} from "./entities/job-chain.js";
import { JobAlreadyCompletedError, JobNotFoundError, WaitChainTimeoutError } from "./errors.js";
import { raceWithSleep } from "./helpers/sleep.js";
import { withJobContext } from "./helpers/job-context.js";
import { type Job } from "./entities/job.js";
import { notifyJobOwnershipLost } from "./helpers/notify-context.js";
import { type CompleteCallbackOptions } from "./worker/job-process.js";
import { setupHelpers } from "./setup-helpers.js";

export type JobChainCompleteOptions<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
  TCompleteReturn,
> = (options: {
  job: ChainJobs<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>;
  complete: <
    TJobTypeName extends ChainJobTypes<TJobTypeDefinitions, TChainTypeName> & string,
    TReturn extends
      | TJobTypeDefinitions[TJobTypeName]["output"]
      | ContinuationJobs<
          GetStateAdapterJobId<TStateAdapter>,
          TJobTypeDefinitions,
          TJobTypeName,
          TChainTypeName
        >
      | Promise<TJobTypeDefinitions[TJobTypeName]["output"]>
      | Promise<
          ContinuationJobs<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TJobTypeName,
            TChainTypeName
          >
        >,
  >(
    job: JobOf<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName
    >,
    completeCallback: (
      completeOptions: CompleteCallbackOptions<
        TStateAdapter,
        TJobTypeDefinitions,
        TJobTypeName,
        TChainTypeName
      >,
    ) => TReturn,
  ) => Promise<Awaited<TReturn>>;
}) => Promise<TCompleteReturn>;

export type CompleteJobChainResult<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends keyof TJobTypeDefinitions & string,
  TCompleteReturn,
> = [TCompleteReturn] extends [void]
  ? JobChainOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>
  : TCompleteReturn extends Job<any, any, any, any, any[]>
    ? JobChainOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>
    : CompletedJobChain<
        JobChain<
          GetStateAdapterJobId<TStateAdapter>,
          TChainTypeName,
          TJobTypeDefinitions[TChainTypeName]["input"],
          TCompleteReturn
        >
      >;

export type Client<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
> = {
  startJobChain: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    options: {
      typeName: TChainTypeName;
      input: TJobTypeDefinitions[TChainTypeName]["input"];
      deduplication?: DeduplicationOptions;
      schedule?: ScheduleOptions;
    } & (HasBlockers<TJobTypeDefinitions, TChainTypeName> extends true
      ? {
          startBlockers: StartBlockersFn<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TChainTypeName
          >;
        }
      : { startBlockers?: never }) &
      GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    JobChainOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName> & {
      deduplicated: boolean;
    }
  >;
  getJobChain: <TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string>(
    options: {
      typeName: TChainTypeName;
      id: GetStateAdapterJobId<TStateAdapter>;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<JobChainOf<
    GetStateAdapterJobId<TStateAdapter>,
    TJobTypeDefinitions,
    TChainTypeName
  > | null>;
  deleteJobChains: (
    options: {
      rootChainIds: GetStateAdapterJobId<TStateAdapter>[];
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<void>;
  completeJobChain: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
    TCompleteReturn,
  >(
    options: {
      typeName: TChainTypeName;
      id: GetStateAdapterJobId<TStateAdapter>;
      complete: JobChainCompleteOptions<
        TStateAdapter,
        TJobTypeDefinitions,
        TChainTypeName,
        TCompleteReturn
      >;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    CompleteJobChainResult<TStateAdapter, TJobTypeDefinitions, TChainTypeName, TCompleteReturn>
  >;
  withNotify: <T>(cb: () => Promise<T>) => Promise<T>;
  waitForJobChainCompletion: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    jobChain: {
      typeName: TChainTypeName;
      id: GetStateAdapterJobId<TStateAdapter>;
    },
    options: {
      timeoutMs: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
    },
  ) => Promise<
    CompletedJobChain<
      JobChainOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>
    >
  >;
};

export const createClient = async <
  TJobTypeRegistry extends JobTypeRegistry<any>,
  TStateAdapter extends StateAdapter<any, any>,
>({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  registry: registryOption,
  log,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  registry: TJobTypeRegistry;
  log?: Log;
}): Promise<Client<TJobTypeRegistry["$definitions"], TStateAdapter>> => {
  const { stateAdapter, notifyAdapter } = setupHelpers({
    stateAdapter: stateAdapterOption,
    notifyAdapter: notifyAdapterOption,
    observabilityAdapter: observabilityAdapterOption,
    registry: registryOption,
    log,
  });

  // TODO: get rid of helper and just use client methods directly
  const h = helper({
    stateAdapter: stateAdapterOption,
    notifyAdapter: notifyAdapterOption,
    observabilityAdapter: observabilityAdapterOption,
    registry: registryOption,
    log,
  });

  return {
    startJobChain: (async ({
      input,
      typeName,
      deduplication,
      schedule,
      startBlockers,
      ...txContext
    }) =>
      h.startJobChain({
        typeName,
        input,
        txContext,
        deduplication,
        schedule,
        startBlockers,
      })) as Client<TJobTypeRegistry["$definitions"], TStateAdapter>["startJobChain"],
    // TODO: should it handle typeName that is not correct for the given id?
    getJobChain: (async ({ id, typeName: _, ...txContext }) => {
      const jobChain = await stateAdapter.getJobChainById({
        txContext,
        jobId: id,
      });

      return jobChain ? mapStateJobPairToJobChain(jobChain) : null;
    }) as Client<TJobTypeRegistry["$definitions"], TStateAdapter>["getJobChain"],
    deleteJobChains: (async ({ rootChainIds, ...txContext }) => {
      const chainJobs = await Promise.all(
        rootChainIds.map(async (chainId: GetStateAdapterJobId<TStateAdapter>) =>
          stateAdapter.getJobById({
            txContext,
            jobId: chainId,
          }),
        ),
      );

      for (let i = 0; i < rootChainIds.length; i++) {
        const chainJob = chainJobs[i];
        const chainId = rootChainIds[i];

        if (!chainJob) {
          throw new JobNotFoundError(`Job chain with id ${chainId} not found`);
        }

        if (chainJob.rootChainId !== chainJob.id) {
          // TODO: properly typed error
          throw new Error(
            `Cannot delete job chain ${chainId}: must delete from the root chain (rootChainId: ${chainJob.rootChainId})`,
          );
        }
      }

      const externalBlockers = await stateAdapter.getExternalBlockers({
        txContext,
        rootChainIds,
      });

      if (externalBlockers.length > 0) {
        const uniqueBlockedRootIds = [
          ...new Set(externalBlockers.map((b) => b.blockedRootChainId)),
        ];
        // TODO: properly typed error
        throw new Error(
          `Cannot delete job chains: external job chains depend on them. ` +
            `Include the following root chains in the deletion: ${uniqueBlockedRootIds.join(", ")}`,
        );
      }

      await stateAdapter.deleteJobsByRootChainIds({
        txContext,
        rootChainIds,
      });
    }) as Client<TJobTypeRegistry["$definitions"], TStateAdapter>["deleteJobChains"],
    completeJobChain: (async ({ id, typeName: _, complete: completeCallback, ...txContext }) => {
      const currentJob = await stateAdapter.getCurrentJobForUpdate({
        txContext,
        chainId: id,
      });

      if (!currentJob) {
        throw new JobNotFoundError(`Job chain with id ${id} not found`);
      }

      const complete = async (
        job: StateJob,
        jobCompleteCallback: (
          options: {
            continueWith: (options: {
              typeName: string;
              input: unknown;
              schedule?: ScheduleOptions;
              startBlockers?: StartBlockersFn<string, BaseJobTypeDefinitions, string>;
            }) => Promise<unknown>;
          } & BaseTxContext,
        ) => unknown,
      ): Promise<unknown> => {
        if (job.status === "completed") {
          throw new JobAlreadyCompletedError(
            `Cannot complete job ${job.id}: job is already completed`,
            { cause: { jobId: job.id } },
          );
        }

        let continuedJob: Job<any, any, any, any, any[]> | null = null;

        const output = await jobCompleteCallback({
          continueWith: async ({ typeName, input, schedule, startBlockers }) => {
            if (continuedJob) {
              throw new Error("continueWith can only be called once");
            }

            return withJobContext(
              {
                chainId: job.chainId,
                rootChainId: job.rootChainId,
                chainTypeName: job.chainTypeName,
                originId: job.id,
                originTraceContext: job.traceContext,
              },
              async () =>
                h.continueWith({
                  typeName,
                  input,
                  txContext,
                  schedule,
                  startBlockers: startBlockers as any,
                  fromTypeName: job.typeName,
                }),
            );
          },
          ...txContext,
        });

        const wasRunning = job.status === "running";

        await h.finishJob(
          continuedJob
            ? { job, txContext, workerId: null, type: "continueWith", continuedJob }
            : { job, txContext, workerId: null, type: "completeChain", output },
        );

        if (wasRunning) {
          notifyJobOwnershipLost(job.id);
        }

        return continuedJob ?? output;
      };

      await completeCallback({ job: currentJob, complete });

      const updatedChain = await stateAdapter.getJobChainById({
        txContext,
        jobId: id,
      });

      if (!updatedChain) {
        throw new JobNotFoundError(`Job chain with id ${id} not found after complete`);
      }

      return mapStateJobPairToJobChain(updatedChain);
    }) as Client<TJobTypeRegistry["$definitions"], TStateAdapter>["completeJobChain"],
    // TODO: should it handle typeName that is not correct for the given id?
    waitForJobChainCompletion: (async ({ id }, { timeoutMs, pollIntervalMs = 15_000, signal }) => {
      const checkChain = async () => {
        const chain = await stateAdapter.getJobChainById({ jobId: id });
        if (!chain) {
          throw new JobNotFoundError(`Job chain with id ${id} not found`);
        }
        const jobChain = mapStateJobPairToJobChain(chain);
        return jobChain.status === "completed" ? jobChain : null;
      };

      const completedChain = await checkChain();
      if (completedChain) {
        return completedChain;
      }

      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      let resolveNotification: (() => void) | null = null;
      let notificationPromise!: Promise<void>;
      const resetNotificationPromise = (): void => {
        const { promise, resolve } = Promise.withResolvers<void>();
        notificationPromise = promise;
        resolveNotification = resolve;
      };
      resetNotificationPromise();

      let dispose: () => Promise<void> = async () => {};
      try {
        dispose = await notifyAdapter.listenJobChainCompleted(id, () => {
          resolveNotification?.();
        });
      } catch {}
      try {
        while (!combinedSignal.aborted) {
          await raceWithSleep(notificationPromise, pollIntervalMs, { signal: combinedSignal });
          resetNotificationPromise();

          const chain = await checkChain();
          if (chain) return chain;

          if (combinedSignal.aborted) break;
        }

        throw new WaitChainTimeoutError(
          signal?.aborted
            ? `Wait for job chain ${id} was aborted`
            : `Timeout waiting for job chain ${id} to complete after ${timeoutMs}ms`,
          { cause: { chainId: id, timeoutMs } },
        );
      } finally {
        await dispose();
      }
    }) as Client<TJobTypeRegistry["$definitions"], TStateAdapter>["waitForJobChainCompletion"],
    withNotify: async (cb, ...args) => h.withNotifyContext(async () => cb(...args)),
  };
};
