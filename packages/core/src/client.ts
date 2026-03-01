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
  JobChainNotFoundError,
  JobTypeMismatchError,
  WaitChainTimeoutError,
} from "./errors.js";
import { bufferNotifyJobOwnershipLost } from "./helpers/notify-hooks.js";
import { raceWithSleep } from "./helpers/sleep.js";
import { createHelpers, type Helpers } from "./setup-helpers.js";
import { type TransactionHooks } from "./transaction-hooks.js";
import { type CompleteCallbackOptions } from "./worker/job-process.js";

const normalizeTxCtx = <T extends Record<string, unknown>>(rest: T): T | undefined =>
  Object.keys(rest).length > 0 ? rest : undefined;

/** Callback type for {@link Client.completeJobChain | completeJobChain}. Receives the current job and a `complete` function. */
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

/** Return type of {@link Client.completeJobChain | completeJobChain}. Narrows to `CompletedJobChain` when the chain is completed, or `JobChain` when continued. */
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

/**
 * The public API for managing job chains. Created via {@link createClient}.
 *
 * Methods are split into two categories:
 * - **Mutating** — `startJobChain`, `completeJobChain`, `deleteJobChains`. Require `transactionHooks` and a transaction context.
 * - **Read-only** — `getJobChain`, `getJob`, `listJobChains`, `listJobs`, `listJobChainJobs`, `getJobBlockers`, `listBlockedJobs`, `awaitJobChain`. Accept an optional transaction context.
 */
export type Client<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
  TJobId extends string = GetStateAdapterJobId<TStateAdapter>,
> = {
  [helpersSymbol]: Helpers;

  /** Create a new job chain. Returns the created chain with a `deduplicated` flag. */
  startJobChain: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    options: {
      typeName: TChainTypeName;
      input: TJobTypeDefinitions[TChainTypeName]["input"];
      transactionHooks: TransactionHooks;
      deduplication?: DeduplicationOptions;
      schedule?: ScheduleOptions;
    } & (HasBlockers<TJobTypeDefinitions, TChainTypeName> extends true
      ? { blockers: BlockerChains<TJobId, TJobTypeDefinitions, TChainTypeName> }
      : { blockers?: never }) &
      GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<JobChainOf<TJobId, TJobTypeDefinitions, TChainTypeName> & { deduplicated: boolean }>;

  /** Delete job chains by ID. Throws {@link BlockerReferenceError} if external jobs depend on them. When `cascade` is true, includes transitive dependencies. */
  deleteJobChains: (
    options: {
      ids: TJobId[];
      cascade?: boolean;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    JobChainOf<
      TJobId,
      TJobTypeDefinitions,
      keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string
    >[]
  >;

  /** Complete a job chain from outside a worker. Validates `typeName`, then passes the current job and a `complete` function to the caller. */
  completeJobChain: <
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
  ) => Promise<
    CompleteJobChainResult<TStateAdapter, TJobTypeDefinitions, TChainTypeName, TCompleteReturn>
  >;

  /** Wait for a job chain to complete. Combines polling with notify adapter events. Throws {@link WaitChainTimeoutError} on timeout or abort. */
  awaitJobChain: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
      keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    jobChain: { typeName?: TChainTypeName; id: TJobId },
    options: { timeoutMs: number; pollIntervalMs?: number; signal?: AbortSignal },
  ) => Promise<CompletedJobChain<JobChainOf<TJobId, TJobTypeDefinitions, TChainTypeName>>>;

  /** Get a single job chain by ID. Pass `typeName` for type narrowing — throws {@link JobTypeMismatchError} on mismatch. */
  getJobChain: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
      keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
  >(
    options: {
      typeName?: TChainTypeName;
      id: TJobId;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<JobChainOf<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined>;

  /** Get a single job by ID. Pass `typeName` for type narrowing — throws {@link JobTypeMismatchError} on mismatch. */
  getJob: <
    TJobTypeName extends keyof TJobTypeDefinitions & string = keyof TJobTypeDefinitions & string,
  >(
    options: {
      typeName?: TJobTypeName;
      id: TJobId;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<JobOf<TJobId, TJobTypeDefinitions, TJobTypeName> | undefined>;

  /** List job chains with filtering and cursor-based pagination. Defaults to newest first. */
  listJobChains: <
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
  ) => Promise<Page<JobChainOf<TJobId, TJobTypeDefinitions, TChainTypeName>>>;

  /** List jobs with filtering and cursor-based pagination. Blockers are not populated — use {@link Client.getJobBlockers | getJobBlockers} for a specific job. Defaults to newest first. */
  listJobs: <TJobTypeName extends keyof TJobTypeDefinitions & string>(
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
  ) => Promise<Page<JobOf<TJobId, TJobTypeDefinitions, TJobTypeName>>>;

  /** List jobs within a specific chain, ordered by `chainIndex`. Defaults to ascending order. */
  listJobChainJobs: <
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
  ) => Promise<Page<ChainJobs<TJobId, TJobTypeDefinitions, TChainTypeName>>>;

  /** Get the blocker chains for a specific job. Not paginated — blockers are bounded by design. Pass `typeName` for type narrowing. */
  getJobBlockers: <
    TJobTypeName extends keyof TJobTypeDefinitions & string = keyof TJobTypeDefinitions & string,
  >(
    options: {
      jobId: TJobId;
      typeName?: TJobTypeName;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<BlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName>>;

  /** List jobs from other chains that are blocked by a given chain. Useful for understanding downstream impact before deletion. */
  listBlockedJobs: <
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
  ) => Promise<
    Page<
      JobOf<
        TJobId,
        TJobTypeDefinitions,
        BlockedJobTypes<TJobTypeDefinitions, TChainTypeName> & keyof TJobTypeDefinitions & string
      >
    >
  >;
};

/**
 * Create a new Queuert client.
 *
 * @param options.stateAdapter - Database adapter for job persistence.
 * @param options.notifyAdapter - Optional pub/sub adapter for real-time notifications.
 * @param options.observabilityAdapter - Optional adapter for logging, metrics, and tracing.
 * @param options.registry - Job type registry (from {@link defineJobTypes} or {@link createJobTypeRegistry}).
 * @param options.log - Optional structured log function.
 */
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

    deleteJobChains: async (
      options: {
        ids: TJobId[];
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
      const { ids, cascade, transactionHooks: _transactionHooks, ...txCtx } = options;

      const deletedChainPairs = await helpers.stateAdapter.deleteJobChains({
        txCtx,
        chainIds: ids,
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
        throw new JobChainNotFoundError(`Job chain with id ${id} not found`, {
          chainId: id as string,
        });
      }

      if (currentJob.chainTypeName !== typeName) {
        throw new JobTypeMismatchError(
          `Expected chain ${String(id)} to have type "${typeName}" but found "${currentJob.chainTypeName}"`,
          { expectedTypeName: typeName, actualTypeName: currentJob.chainTypeName },
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
            { jobId: job.id },
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
        throw new JobChainNotFoundError(`Job chain with id ${id} not found after complete`, {
          chainId: id as string,
        });
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
        const jobChain = await helpers.stateAdapter.getJobChainById({ chainId: id });
        if (!jobChain) {
          throw new JobChainNotFoundError(`Job chain with id ${id} not found`, {
            chainId: id as string,
          });
        }

        if (!typeValidated) {
          if (jobChain[0].chainTypeName !== typeName) {
            throw new JobTypeMismatchError(
              `Expected chain ${String(id)} to have type "${typeName}" but found "${jobChain[0].chainTypeName}"`,
              { expectedTypeName: typeName!, actualTypeName: jobChain[0].chainTypeName },
            );
          }
          typeValidated = true;
        }

        const mapped = mapStateJobPairToJobChain(jobChain);
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

          const jobChain = await checkChain();
          if (jobChain) return jobChain;

          if (combinedSignal.aborted) break;
        }

        throw new WaitChainTimeoutError(
          signal?.aborted
            ? `Wait for job chain ${id} was aborted`
            : `Timeout waiting for job chain ${id} to complete after ${timeoutMs}ms`,
          { chainId: id as string, timeoutMs, cause: signal?.reason },
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
    ): Promise<JobChainOf<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined> => {
      const { id, typeName, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);
      const jobChainPair = await helpers.stateAdapter.getJobChainById({
        txCtx,
        chainId: id,
      });

      if (!jobChainPair) return undefined;

      if (typeName && jobChainPair[0].chainTypeName !== typeName) {
        throw new JobTypeMismatchError(
          `Expected chain ${String(id)} to have type "${typeName}" but found "${jobChainPair[0].chainTypeName}"`,
          { expectedTypeName: typeName, actualTypeName: jobChainPair[0].chainTypeName },
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
    ): Promise<JobOf<TJobId, TJobTypeDefinitions, TJobTypeName> | undefined> => {
      const { id, typeName, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);
      const job = await helpers.stateAdapter.getJobById({ txCtx, jobId: id });

      if (!job) return undefined;

      if (typeName && job.typeName !== typeName) {
        throw new JobTypeMismatchError(
          `Expected job ${String(id)} to have type "${typeName}" but found "${job.typeName}"`,
          { expectedTypeName: typeName, actualTypeName: job.typeName },
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
        const jobChain = await helpers.stateAdapter.getJobChainById({ txCtx, chainId: jobChainId });
        if (jobChain && jobChain[0].chainTypeName !== typeName) {
          throw new JobTypeMismatchError(
            `Expected chain ${String(jobChainId)} to have type "${typeName}" but found "${jobChain[0].chainTypeName}"`,
            { expectedTypeName: typeName, actualTypeName: jobChain[0].chainTypeName },
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
            { expectedTypeName: typeName, actualTypeName: job.typeName },
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
        const jobChain = await helpers.stateAdapter.getJobChainById({ txCtx, chainId: jobChainId });
        if (jobChain && jobChain[0].chainTypeName !== typeName) {
          throw new JobTypeMismatchError(
            `Expected chain ${String(jobChainId)} to have type "${typeName}" but found "${jobChain[0].chainTypeName}"`,
            { expectedTypeName: typeName, actualTypeName: jobChain[0].chainTypeName },
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
  } as unknown as Client<TJobTypeRegistry["$definitions"], TStateAdapter>;
};
