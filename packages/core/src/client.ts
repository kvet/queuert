export const helpersSymbol = Symbol("queuert.helpers");

import { type JobTypeRegistry } from "./entities/job-type-registry.js";
import {
  type BaseJobTypeDefinitions,
  type BlockedJobTypes,
  type BlockerChains,
  type ChainJobTypes,
  type ChainJobs,
  type ContinuationJobs,
  type EntryJobTypeDefinitions,
  type HasBlockers,
  type JobChainOf,
  type JobOf,
} from "./entities/job-type.js";
import { type ScheduleOptions } from "./entities/schedule.js";
import { continueWith } from "./implementation/continue-with.js";
import { finishJob } from "./implementation/finish-job.js";
import { startJobChain } from "./implementation/start-job-chain.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { type Log } from "./observability-adapter/log.js";
import { type ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import { type OrderDirection, type Page } from "./pagination.js";
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
import { type CreatedJob, type Job, type JobStatus, mapStateJobToJob } from "./entities/job.js";
import {
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobTypeMismatchError,
  WaitChainTimeoutError,
} from "./errors.js";
import { bufferNotifyJobOwnershipLost } from "./helpers/notify-hooks.js";
import { raceWithSleep } from "./helpers/sleep.js";
import { createHelpers } from "./setup-helpers.js";
import { type TransactionHooks } from "./transaction-hooks.js";
import { type CompleteCallbackOptions } from "./worker/job-process.js";

const normalizeTxCtx = <T extends Record<string, unknown>>(rest: T): T | undefined =>
  Object.keys(rest).length > 0 ? rest : undefined;

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
  : TCompleteReturn extends CreatedJob<Job<any, any, any, any>>
    ? JobChainOf<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>
    : CompletedJobChain<
        JobChain<
          GetStateAdapterJobId<TStateAdapter>,
          TChainTypeName,
          TJobTypeDefinitions[TChainTypeName]["input"],
          TCompleteReturn
        >
      >;

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
}) => {
  type TJobTypeDefinitions = TJobTypeRegistry["$definitions"];
  type TJobId = GetStateAdapterJobId<TStateAdapter>;

  const helpers = createHelpers({
    stateAdapter: stateAdapterOption,
    notifyAdapter: notifyAdapterOption,
    observabilityAdapter: observabilityAdapterOption,
    registry: registryOption,
    log,
  });
  return {
    [helpersSymbol]: helpers,

    startJobChain: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
    >(
      options: {
        typeName: TChainTypeName;
        input: TJobTypeDefinitions[TChainTypeName]["input"];
        transactionHooks: TransactionHooks;
        deduplication?: DeduplicationOptions;
        schedule?: ScheduleOptions;
      } & (HasBlockers<TJobTypeDefinitions, TChainTypeName> extends true
        ? {
            blockers: BlockerChains<TJobId, TJobTypeDefinitions, TChainTypeName>;
          }
        : { blockers?: never }) &
        GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<
      JobChainOf<TJobId, TJobTypeDefinitions, TChainTypeName> & {
        deduplicated: boolean;
      }
    > => {
      const { input, typeName, deduplication, schedule, blockers, transactionHooks, ...txCtx } =
        options;
      return (await startJobChain(helpers, {
        typeName,
        input,
        txCtx,
        transactionHooks,
        deduplication,
        schedule,
        blockers,
      })) as JobChainOf<TJobId, TJobTypeDefinitions, TChainTypeName> & { deduplicated: boolean };
    },

    // TODO: use transactionHooks to buffer post-delete side effects (e.g., observability events)
    deleteJobChains: async (
      options: {
        chainIds: TJobId[];
        cascade?: boolean;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<
      JobChainOf<
        TJobId,
        TJobTypeDefinitions,
        keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string
      >[]
    > => {
      const { chainIds, cascade, transactionHooks: _transactionHooks, ...txCtx } = options;

      const deletedChainPairs = await helpers.stateAdapter.deleteJobChains({
        txCtx,
        chainIds,
        cascade,
      });

      return deletedChainPairs.map(
        (pair) =>
          mapStateJobPairToJobChain(pair) as JobChainOf<
            TJobId,
            TJobTypeDefinitions,
            keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string
          >,
      );
    },

    completeJobChain: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
      TCompleteReturn,
    >(
      options: {
        typeName: TChainTypeName;
        id: TJobId;
        transactionHooks: TransactionHooks;
        complete: JobChainCompleteOptions<
          TStateAdapter,
          TJobTypeDefinitions,
          TChainTypeName,
          TCompleteReturn
        >;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<
      CompleteJobChainResult<TStateAdapter, TJobTypeDefinitions, TChainTypeName, TCompleteReturn>
    > => {
      const { id, typeName, complete: completeCallback, transactionHooks, ...txCtx } = options;
      const currentJob = await helpers.stateAdapter.getLatestChainJobForUpdate({
        txCtx,
        chainId: id,
      });

      if (!currentJob) {
        throw new JobNotFoundError(`Job chain with id ${id} not found`);
      }

      if (currentJob.chainTypeName !== typeName) {
        throw new JobTypeMismatchError(
          `Expected chain ${String(id)} to have type "${typeName}" but found "${currentJob.chainTypeName}"`,
          { cause: { expectedTypeName: typeName, actualTypeName: currentJob.chainTypeName } },
        );
      }

      const complete = async (
        job: StateJob,
        jobCompleteCallback: (
          options: {
            continueWith: (options: {
              typeName: string;
              input: unknown;
              schedule?: ScheduleOptions;
              blockers?: JobChain<any, any, any, any>[];
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

        let continuedJob: Job<any, any, any, any> | null = null;

        const output = await jobCompleteCallback({
          continueWith: async ({ typeName, input, schedule, blockers }) => {
            if (continuedJob) {
              throw new Error("continueWith can only be called once");
            }

            continuedJob = await continueWith(helpers, {
              typeName,
              input,
              txCtx,
              transactionHooks,
              schedule,
              blockers: blockers as any,
              chainId: job.chainId,
              chainIndex: job.chainIndex + 1,
              chainTypeName: job.chainTypeName,
              originChainTraceContext: job.chainTraceContext,
              originTraceContext: job.traceContext,
              fromTypeName: job.typeName,
            });

            return continuedJob;
          },
          ...txCtx,
        });

        const wasRunning = job.status === "running";

        await finishJob(
          helpers,
          continuedJob
            ? { job, txCtx, transactionHooks, workerId: null, type: "continueWith", continuedJob }
            : { job, txCtx, transactionHooks, workerId: null, type: "completeChain", output },
        );

        if (wasRunning) {
          bufferNotifyJobOwnershipLost(transactionHooks, helpers.notifyAdapter, job.id);
        }

        return continuedJob ?? output;
      };

      await completeCallback({ job: currentJob, complete });

      const updatedChain = await helpers.stateAdapter.getJobChainById({
        txCtx,
        chainId: id,
      });

      if (!updatedChain) {
        throw new JobNotFoundError(`Job chain with id ${id} not found after complete`);
      }

      return mapStateJobPairToJobChain(updatedChain) as CompleteJobChainResult<
        TStateAdapter,
        TJobTypeDefinitions,
        TChainTypeName,
        TCompleteReturn
      >;
    },

    awaitJobChain: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
        keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
    >(
      jobChain: {
        typeName?: TChainTypeName;
        id: TJobId;
      },
      options: {
        timeoutMs: number;
        pollIntervalMs?: number;
        signal?: AbortSignal;
      },
    ): Promise<CompletedJobChain<JobChainOf<TJobId, TJobTypeDefinitions, TChainTypeName>>> => {
      const { id, typeName } = jobChain;
      const { timeoutMs, pollIntervalMs = 15_000, signal } = options;

      let typeValidated = !typeName;

      const checkChain = async () => {
        const chain = await helpers.stateAdapter.getJobChainById({ chainId: id });
        if (!chain) {
          throw new JobNotFoundError(`Job chain with id ${id} not found`);
        }

        if (!typeValidated) {
          if (chain[0].chainTypeName !== typeName) {
            throw new JobTypeMismatchError(
              `Expected chain ${String(id)} to have type "${typeName}" but found "${chain[0].chainTypeName}"`,
              {
                cause: {
                  expectedTypeName: typeName!,
                  actualTypeName: chain[0].chainTypeName,
                },
              },
            );
          }
          typeValidated = true;
        }

        const mapped = mapStateJobPairToJobChain(chain);
        return mapped.status === "completed"
          ? (mapped as CompletedJobChain<JobChainOf<TJobId, TJobTypeDefinitions, TChainTypeName>>)
          : null;
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
        dispose = await helpers.notifyAdapter.listenJobChainCompleted(id, () => {
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
    },

    getJobChain: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
        keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
    >(
      options: {
        typeName?: TChainTypeName;
        id: TJobId;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<JobChainOf<TJobId, TJobTypeDefinitions, TChainTypeName> | null> => {
      const { id, typeName, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);
      const jobChainPair = await helpers.stateAdapter.getJobChainById({
        txCtx,
        chainId: id,
      });

      if (!jobChainPair) return null;

      if (typeName && jobChainPair[0].chainTypeName !== typeName) {
        throw new JobTypeMismatchError(
          `Expected chain ${String(id)} to have type "${typeName}" but found "${jobChainPair[0].chainTypeName}"`,
          { cause: { expectedTypeName: typeName, actualTypeName: jobChainPair[0].chainTypeName } },
        );
      }

      return mapStateJobPairToJobChain(jobChainPair) as JobChainOf<
        TJobId,
        TJobTypeDefinitions,
        TChainTypeName
      >;
    },

    getJob: async <
      TJobTypeName extends keyof TJobTypeDefinitions & string = keyof TJobTypeDefinitions & string,
    >(
      options: {
        typeName?: TJobTypeName;
        id: TJobId;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<JobOf<TJobId, TJobTypeDefinitions, TJobTypeName> | null> => {
      const { id, typeName, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);
      const job = await helpers.stateAdapter.getJobById({ txCtx, jobId: id });

      if (!job) return null;

      if (typeName && job.typeName !== typeName) {
        throw new JobTypeMismatchError(
          `Expected job ${String(id)} to have type "${typeName}" but found "${job.typeName}"`,
          { cause: { expectedTypeName: typeName, actualTypeName: job.typeName } },
        );
      }

      return mapStateJobToJob(job) as JobOf<TJobId, TJobTypeDefinitions, TJobTypeName>;
    },
    listJobChains: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
    >(
      options: {
        filter?: {
          typeName?: TChainTypeName[];
          status?: JobStatus[];
          id?: TJobId[];
          jobId?: TJobId[];
          root?: boolean;
          from?: Date;
          to?: Date;
        };
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<JobChainOf<TJobId, TJobTypeDefinitions, TChainTypeName>>> => {
      const { filter, orderDirection = "desc", cursor, limit = 50, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);
      const result = await helpers.stateAdapter.listJobChains({
        txCtx,
        filter: {
          typeName: filter?.typeName,
          status: filter?.status,
          rootOnly: filter?.root,
          chainId: filter?.id,
          jobId: filter?.jobId,
          from: filter?.from,
          to: filter?.to,
        },
        orderDirection,
        page: { cursor, limit },
      });
      return {
        items: result.items.map(
          (pair) =>
            mapStateJobPairToJobChain(pair) as JobChainOf<
              TJobId,
              TJobTypeDefinitions,
              TChainTypeName
            >,
        ),
        nextCursor: result.nextCursor,
      };
    },

    listJobs: async <TJobTypeName extends keyof TJobTypeDefinitions & string>(
      options: {
        filter?: {
          typeName?: TJobTypeName[];
          id?: TJobId[];
          jobChainId?: TJobId[];
          status?: JobStatus[];
          from?: Date;
          to?: Date;
        };
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<JobOf<TJobId, TJobTypeDefinitions, TJobTypeName>>> => {
      const { filter, orderDirection = "desc", cursor, limit = 50, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);
      const result = await helpers.stateAdapter.listJobs({
        txCtx,
        filter: {
          typeName: filter?.typeName,
          jobId: filter?.id,
          chainId: filter?.jobChainId,
          status: filter?.status,
          from: filter?.from,
          to: filter?.to,
        },
        orderDirection,
        page: { cursor, limit },
      });
      return {
        items: result.items.map(
          (job) => mapStateJobToJob(job) as JobOf<TJobId, TJobTypeDefinitions, TJobTypeName>,
        ),
        nextCursor: result.nextCursor,
      };
    },

    listJobChainJobs: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
        keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
    >(
      options: {
        jobChainId: TJobId;
        typeName?: TChainTypeName;
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<ChainJobs<TJobId, TJobTypeDefinitions, TChainTypeName>>> => {
      const { jobChainId, typeName, orderDirection = "asc", cursor, limit = 50, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);

      if (typeName) {
        const chain = await helpers.stateAdapter.getJobChainById({ txCtx, chainId: jobChainId });
        if (chain && chain[0].chainTypeName !== typeName) {
          throw new JobTypeMismatchError(
            `Expected chain ${String(jobChainId)} to have type "${typeName}" but found "${chain[0].chainTypeName}"`,
            { cause: { expectedTypeName: typeName, actualTypeName: chain[0].chainTypeName } },
          );
        }
      }

      const result = await helpers.stateAdapter.listJobChainJobs({
        txCtx,
        chainId: jobChainId,
        orderDirection,
        page: { cursor, limit },
      });
      return {
        items: result.items.map(
          (job) => mapStateJobToJob(job) as ChainJobs<TJobId, TJobTypeDefinitions, TChainTypeName>,
        ),
        nextCursor: result.nextCursor,
      };
    },

    getJobBlockers: async <
      TJobTypeName extends keyof TJobTypeDefinitions & string = keyof TJobTypeDefinitions & string,
    >(
      options: {
        jobId: TJobId;
        typeName?: TJobTypeName;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<BlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName>> => {
      const { jobId, typeName, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);

      if (typeName) {
        const job = await helpers.stateAdapter.getJobById({ txCtx, jobId });
        if (job && job.typeName !== typeName) {
          throw new JobTypeMismatchError(
            `Expected job ${String(jobId)} to have type "${typeName}" but found "${job.typeName}"`,
            { cause: { expectedTypeName: typeName, actualTypeName: job.typeName } },
          );
        }
      }

      const blockers = await helpers.stateAdapter.getJobBlockers({ txCtx, jobId });
      return blockers.map((pair) => mapStateJobPairToJobChain(pair)) as BlockerChains<
        TJobId,
        TJobTypeDefinitions,
        TJobTypeName
      >;
    },

    listBlockedJobs: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
        keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
    >(
      options: {
        jobChainId: TJobId;
        typeName?: TChainTypeName;
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<
      Page<
        JobOf<
          TJobId,
          TJobTypeDefinitions,
          BlockedJobTypes<TJobTypeDefinitions, TChainTypeName> & keyof TJobTypeDefinitions & string
        >
      >
    > => {
      const {
        jobChainId,
        typeName,
        orderDirection = "desc",
        cursor,
        limit = 50,
        ...rest
      } = options;
      const txCtx = normalizeTxCtx(rest);

      if (typeName) {
        const chain = await helpers.stateAdapter.getJobChainById({ txCtx, chainId: jobChainId });
        if (chain && chain[0].chainTypeName !== typeName) {
          throw new JobTypeMismatchError(
            `Expected chain ${String(jobChainId)} to have type "${typeName}" but found "${chain[0].chainTypeName}"`,
            { cause: { expectedTypeName: typeName, actualTypeName: chain[0].chainTypeName } },
          );
        }
      }

      const result = await helpers.stateAdapter.listBlockedJobs({
        txCtx,
        chainId: jobChainId,
        orderDirection,
        page: { cursor, limit },
      });
      return {
        items: result.items.map(
          (job) =>
            mapStateJobToJob(job) as JobOf<
              TJobId,
              TJobTypeDefinitions,
              BlockedJobTypes<TJobTypeDefinitions, TChainTypeName> &
                keyof TJobTypeDefinitions &
                string
            >,
        ),
        nextCursor: result.nextCursor,
      };
    },
  };
};

export type Client<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
> = Awaited<ReturnType<typeof createClient<JobTypeRegistry<TJobTypeDefinitions>, TStateAdapter>>>;
