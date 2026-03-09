import { type DeduplicationOptions } from "./entities/deduplication.js";
import {
  type JobTypeRegistry,
  type JobTypeRegistryNavigation,
} from "./entities/job-type-registry.js";
import { type BaseNavigationMap } from "./entities/job-type-registry.navigation.js";
import {
  type BlockedJobTypeNames,
  type BlockerChains,
  type ChainJobTypeNames,
  type ContinuationJobs,
  type EntryJobTypeDefinitions,
  type JobTypeHasBlockers,
  type ResolvedChainJobs,
  type ResolvedJob,
  type ResolvedJobChain,
} from "./entities/job-type-registry.resolvers.js";
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
  type GetStateAdapterJobId,
  type GetStateAdapterTxContext,
  type StateAdapter,
  type StateJob,
} from "./state-adapter/state-adapter.js";

import { type JobChain, mapStateJobPairToJobChain } from "./entities/job-chain.js";
import { type Job, type JobStatus, mapStateJobToJob } from "./entities/job.js";
import {
  JobAlreadyCompletedError,
  JobChainNotFoundError,
  JobTypeMismatchError,
  WaitChainTimeoutError,
} from "./errors.js";
import { bufferNotifyJobOwnershipLost } from "./helpers/notify-hooks.js";
import { raceWithSleep } from "./helpers/sleep.js";
import { type Helpers, createHelpers } from "./setup-helpers.js";
import { type TransactionHooks } from "./transaction-hooks.js";
import { type AttemptCompleteOptions } from "./worker/job-process.js";

export const helpersSymbol: unique symbol = Symbol("queuert.helpers");

const normalizeTxCtx = <T extends Record<string, unknown>>(rest: T): T | undefined =>
  Object.keys(rest).length > 0 ? rest : undefined;

/** Callback type for {@link Client.completeJobChain | completeJobChain}. Receives the current job and a `complete` function. */
export type JobChainCompleteOptions<
  TStateAdapter extends StateAdapter<any, any>,
  TNavigationMap extends BaseNavigationMap,
  TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string,
  TCompleteReturn,
> = (options: {
  job: ResolvedChainJobs<GetStateAdapterJobId<TStateAdapter>, TNavigationMap, TChainTypeName>;
  complete: <
    TJobTypeName extends ChainJobTypeNames<TNavigationMap, TChainTypeName> & string,
    TReturn extends
      | TNavigationMap[TJobTypeName]["output"]
      | ContinuationJobs<
          GetStateAdapterJobId<TStateAdapter>,
          TNavigationMap,
          TJobTypeName,
          TChainTypeName
        >
      | Promise<TNavigationMap[TJobTypeName]["output"]>
      | Promise<
          ContinuationJobs<
            GetStateAdapterJobId<TStateAdapter>,
            TNavigationMap,
            TJobTypeName,
            TChainTypeName
          >
        >,
  >(
    job: ResolvedJob<
      GetStateAdapterJobId<TStateAdapter>,
      TNavigationMap,
      TJobTypeName,
      TChainTypeName
    >,
    completeCallback: (
      completeOptions: AttemptCompleteOptions<
        TStateAdapter,
        TNavigationMap,
        TJobTypeName,
        TChainTypeName
      >,
    ) => TReturn,
  ) => Promise<Awaited<TReturn>>;
}) => Promise<TCompleteReturn>;

/** Return type of {@link Client.completeJobChain | completeJobChain}. Narrows to `CompletedJobChain` when the chain is completed, or `JobChain` when continued. */
export type CompleteJobChainResult<
  TStateAdapter extends StateAdapter<any, any>,
  TNavigationMap extends BaseNavigationMap,
  TChainTypeName extends keyof TNavigationMap & string,
  TCompleteReturn,
> = [TCompleteReturn] extends [void]
  ? ResolvedJobChain<GetStateAdapterJobId<TStateAdapter>, TNavigationMap, TChainTypeName>
  : TCompleteReturn extends Job<any, any, any, any> &
        ({ status: "pending" } | { status: "blocked" })
    ? ResolvedJobChain<GetStateAdapterJobId<TStateAdapter>, TNavigationMap, TChainTypeName>
    : JobChain<
        GetStateAdapterJobId<TStateAdapter>,
        TChainTypeName,
        TNavigationMap[TChainTypeName]["input"],
        TCompleteReturn
      > & { status: "completed" };

/**
 * The public API for managing job chains. Created via {@link createClient}.
 *
 * Methods are split into two categories:
 * - **Mutating** — `startJobChain`, `completeJobChain`, `deleteJobChains`. Require `transactionHooks` and a transaction context.
 * - **Read-only** — `getJobChain`, `getJob`, `listJobChains`, `listJobs`, `listJobChainJobs`, `getJobBlockers`, `listBlockedJobs`, `awaitJobChain`. Accept an optional transaction context.
 */
export type Client<
  TNavigationMap extends BaseNavigationMap,
  TStateAdapter extends StateAdapter<any, any>,
  TJobId = GetStateAdapterJobId<TStateAdapter>,
> = {
  readonly [helpersSymbol]: Helpers;

  startJobChain: <TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string>(
    options: {
      typeName: TChainTypeName;
      input: TNavigationMap[TChainTypeName]["input"];
      transactionHooks: TransactionHooks;
      deduplication?: DeduplicationOptions;
      schedule?: ScheduleOptions;
    } & (JobTypeHasBlockers<TNavigationMap, TChainTypeName> extends true
      ? {
          blockers: BlockerChains<TJobId, TNavigationMap, TChainTypeName>;
        }
      : { blockers?: never }) &
      GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    ResolvedJobChain<TJobId, TNavigationMap, TChainTypeName> & {
      deduplicated: boolean;
    }
  >;

  deleteJobChains: (
    options: {
      ids: TJobId[];
      cascade?: boolean;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    ResolvedJobChain<
      TJobId,
      TNavigationMap,
      keyof EntryJobTypeDefinitions<TNavigationMap> & string
    >[]
  >;

  completeJobChain: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string,
    TCompleteReturn,
  >(
    options: {
      typeName: TChainTypeName;
      id: TJobId;
      transactionHooks: TransactionHooks;
      complete: JobChainCompleteOptions<
        TStateAdapter,
        TNavigationMap,
        TChainTypeName,
        TCompleteReturn
      >;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    CompleteJobChainResult<TStateAdapter, TNavigationMap, TChainTypeName, TCompleteReturn>
  >;

  awaitJobChain: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string =
      keyof EntryJobTypeDefinitions<TNavigationMap> & string,
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
  ) => Promise<ResolvedJobChain<TJobId, TNavigationMap, TChainTypeName> & { status: "completed" }>;

  getJobChain: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string =
      keyof EntryJobTypeDefinitions<TNavigationMap> & string,
  >(
    options: {
      typeName?: TChainTypeName;
      id: TJobId;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<ResolvedJobChain<TJobId, TNavigationMap, TChainTypeName> | undefined>;

  getJob: <TJobTypeName extends keyof TNavigationMap & string = keyof TNavigationMap & string>(
    options: {
      typeName?: TJobTypeName;
      id: TJobId;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<ResolvedJob<TJobId, TNavigationMap, TJobTypeName> | undefined>;

  listJobChains: <TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string>(
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
  ) => Promise<Page<ResolvedJobChain<TJobId, TNavigationMap, TChainTypeName>>>;

  listJobs: <TJobTypeName extends keyof TNavigationMap & string>(
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
  ) => Promise<Page<ResolvedJob<TJobId, TNavigationMap, TJobTypeName>>>;

  listJobChainJobs: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string =
      keyof EntryJobTypeDefinitions<TNavigationMap> & string,
  >(
    options: {
      jobChainId: TJobId;
      typeName?: TChainTypeName;
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<Page<ResolvedChainJobs<TJobId, TNavigationMap, TChainTypeName>>>;

  getJobBlockers: <
    TJobTypeName extends keyof TNavigationMap & string = keyof TNavigationMap & string,
  >(
    options: {
      jobId: TJobId;
      typeName?: TJobTypeName;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<BlockerChains<TJobId, TNavigationMap, TJobTypeName>>;

  listBlockedJobs: <
    TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string =
      keyof EntryJobTypeDefinitions<TNavigationMap> & string,
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
      ResolvedJob<
        TJobId,
        TNavigationMap,
        BlockedJobTypeNames<TNavigationMap, TChainTypeName> & keyof TNavigationMap & string
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
 * @param options.registry - Job type registry (from {@link defineJobTypeRegistry} or {@link createJobTypeRegistry}).
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
}): Promise<Client<JobTypeRegistryNavigation<TJobTypeRegistry>, TStateAdapter>> => {
  type TNavigationMap = JobTypeRegistryNavigation<TJobTypeRegistry>;
  type TJobId = GetStateAdapterJobId<TStateAdapter>;

  const helpers = createHelpers({
    stateAdapter: stateAdapterOption,
    notifyAdapter: notifyAdapterOption,
    observabilityAdapter: observabilityAdapterOption,
    registry: registryOption,
    log,
  });
  const client: Client<TNavigationMap, TStateAdapter> = {
    [helpersSymbol]: helpers,

    /** Create a new job chain. Returns the created chain with a `deduplicated` flag. */
    startJobChain: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string,
    >(
      options: {
        typeName: TChainTypeName;
        input: TNavigationMap[TChainTypeName]["input"];
        transactionHooks: TransactionHooks;
        deduplication?: DeduplicationOptions;
        schedule?: ScheduleOptions;
      } & (JobTypeHasBlockers<TNavigationMap, TChainTypeName> extends true
        ? {
            blockers: BlockerChains<TJobId, TNavigationMap, TChainTypeName>;
          }
        : { blockers?: never }) &
        GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<
      ResolvedJobChain<TJobId, TNavigationMap, TChainTypeName> & {
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
      })) as ResolvedJobChain<TJobId, TNavigationMap, TChainTypeName> & {
        deduplicated: boolean;
      };
    },

    /** Delete job chains by ID. Throws {@link BlockerReferenceError} if external jobs depend on them. When `cascade` is true, includes transitive dependencies. */
    deleteJobChains: async (
      options: {
        ids: TJobId[];
        cascade?: boolean;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<
      ResolvedJobChain<
        TJobId,
        TNavigationMap,
        keyof EntryJobTypeDefinitions<TNavigationMap> & string
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
          mapStateJobPairToJobChain(pair) as ResolvedJobChain<
            TJobId,
            TNavigationMap,
            keyof EntryJobTypeDefinitions<TNavigationMap> & string
          >,
      );
    },

    /** Complete a job chain from outside a worker. Validates `typeName`, then passes the current job and a `complete` function to the caller. */
    completeJobChain: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string,
      TCompleteReturn,
    >(
      options: {
        typeName: TChainTypeName;
        id: TJobId;
        transactionHooks: TransactionHooks;
        complete: JobChainCompleteOptions<
          TStateAdapter,
          TNavigationMap,
          TChainTypeName,
          TCompleteReturn
        >;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<
      CompleteJobChainResult<TStateAdapter, TNavigationMap, TChainTypeName, TCompleteReturn>
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
            transactionHooks: TransactionHooks;
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
          transactionHooks,
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
        TNavigationMap,
        TChainTypeName,
        TCompleteReturn
      >;
    },

    /** Wait for a job chain to complete. Combines polling with notify adapter events. Throws {@link WaitChainTimeoutError} on timeout or abort. */
    awaitJobChain: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string =
        keyof EntryJobTypeDefinitions<TNavigationMap> & string,
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
    ): Promise<
      ResolvedJobChain<TJobId, TNavigationMap, TChainTypeName> & { status: "completed" }
    > => {
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
          ? (mapped as ResolvedJobChain<TJobId, TNavigationMap, TChainTypeName> & {
              status: "completed";
            })
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

    /** Get a single job chain by ID. Pass `typeName` for type narrowing — throws {@link JobTypeMismatchError} on mismatch. */
    getJobChain: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string =
        keyof EntryJobTypeDefinitions<TNavigationMap> & string,
    >(
      options: {
        typeName?: TChainTypeName;
        id: TJobId;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<ResolvedJobChain<TJobId, TNavigationMap, TChainTypeName> | undefined> => {
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

      return mapStateJobPairToJobChain(jobChainPair) as ResolvedJobChain<
        TJobId,
        TNavigationMap,
        TChainTypeName
      >;
    },

    /** Get a single job by ID. Pass `typeName` for type narrowing — throws {@link JobTypeMismatchError} on mismatch. */
    getJob: async <
      TJobTypeName extends keyof TNavigationMap & string = keyof TNavigationMap & string,
    >(
      options: {
        typeName?: TJobTypeName;
        id: TJobId;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<ResolvedJob<TJobId, TNavigationMap, TJobTypeName> | undefined> => {
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

      return mapStateJobToJob(job) as ResolvedJob<TJobId, TNavigationMap, TJobTypeName>;
    },
    /** List job chains with filtering and cursor-based pagination. Defaults to newest first. */
    listJobChains: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string,
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
    ): Promise<Page<ResolvedJobChain<TJobId, TNavigationMap, TChainTypeName>>> => {
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
            mapStateJobPairToJobChain(pair) as ResolvedJobChain<
              TJobId,
              TNavigationMap,
              TChainTypeName
            >,
        ),
        nextCursor: result.nextCursor,
      };
    },

    /** List jobs with filtering and cursor-based pagination. Blockers are not populated — use `getJobBlockers` for a specific job. Defaults to newest first. */
    listJobs: async <TJobTypeName extends keyof TNavigationMap & string>(
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
    ): Promise<Page<ResolvedJob<TJobId, TNavigationMap, TJobTypeName>>> => {
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
          (job) => mapStateJobToJob(job) as ResolvedJob<TJobId, TNavigationMap, TJobTypeName>,
        ),
        nextCursor: result.nextCursor,
      };
    },

    /** List jobs within a specific chain, ordered by `chainIndex`. Defaults to ascending order. */
    listJobChainJobs: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string =
        keyof EntryJobTypeDefinitions<TNavigationMap> & string,
    >(
      options: {
        jobChainId: TJobId;
        typeName?: TChainTypeName;
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<ResolvedChainJobs<TJobId, TNavigationMap, TChainTypeName>>> => {
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
          (job) =>
            mapStateJobToJob(job) as ResolvedChainJobs<TJobId, TNavigationMap, TChainTypeName>,
        ),
        nextCursor: result.nextCursor,
      };
    },

    /** Get the blocker chains for a specific job. Not paginated — blockers are bounded by design. Pass `typeName` for type narrowing. */
    getJobBlockers: async <
      TJobTypeName extends keyof TNavigationMap & string = keyof TNavigationMap & string,
    >(
      options: {
        jobId: TJobId;
        typeName?: TJobTypeName;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<BlockerChains<TJobId, TNavigationMap, TJobTypeName>> => {
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
        TNavigationMap,
        TJobTypeName
      >;
    },

    /** List jobs from other chains that are blocked by a given chain. Useful for understanding downstream impact before deletion. */
    listBlockedJobs: async <
      TChainTypeName extends keyof EntryJobTypeDefinitions<TNavigationMap> & string =
        keyof EntryJobTypeDefinitions<TNavigationMap> & string,
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
        ResolvedJob<
          TJobId,
          TNavigationMap,
          BlockedJobTypeNames<TNavigationMap, TChainTypeName> & keyof TNavigationMap & string
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
            mapStateJobToJob(job) as ResolvedJob<
              TJobId,
              TNavigationMap,
              BlockedJobTypeNames<TNavigationMap, TChainTypeName> & keyof TNavigationMap & string
            >,
        ),
        nextCursor: result.nextCursor,
      };
    },
  };
  return client;
};
