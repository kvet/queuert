import { type DeduplicationOptions } from "./entities/deduplication.js";
import {
  type JobTypeRegistry,
  type JobTypeRegistryDefinitions,
} from "./entities/job-type-registry.js";
import {
  type BlockerChains,
  type ContinuationJobs,
  type JobTypeBlockedNames,
  type JobTypeChainNames,
  type JobTypeEntryNames,
  type JobTypeHasBlockers,
  type JobTypeNames,
  type JobTypeProperty,
  type ResolvedChainJobs,
  type ResolvedJob,
  type ResolvedJobChain,
} from "./entities/job-type-registry.resolvers.js";
import { type BaseJobTypeDefinitions } from "./entities/job-type.js";
import { type ScheduleOptions } from "./entities/schedule.js";
import { continueWith } from "./implementation/continue-with.js";
import { finishJob } from "./implementation/finish-job.js";
import { startJobChains } from "./implementation/start-job-chains.js";
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
  JobNotFoundError,
  JobNotTriggerableError,
  JobTypeMismatchError,
  WaitChainTimeoutError,
} from "./errors.js";
import { bufferNotifyJobOwnershipLost, bufferNotifyJobScheduled } from "./helpers/notify-hooks.js";
import { bufferObservabilityEvent } from "./helpers/observability-hooks.js";
import { raceWithSleep } from "./helpers/sleep.js";
import { type IsUnion } from "./helpers/typescript.js";
import { type Helpers, createHelpers } from "./setup-helpers.js";
import { type TransactionHooks } from "./transaction-hooks.js";
import { type AttemptCompleteOptions } from "./worker/job-process.js";

/** @internal Used by `createInProcessWorker` and `createDashboard` to access client internals. Not part of the public API. */
export const helpersSymbol: unique symbol = Symbol("queuert.helpers");

const normalizeTxCtx = <T extends Record<string, unknown>>(rest: T): T | undefined =>
  Object.keys(rest).length > 0 ? rest : undefined;

type _JobChainCompleteOptions<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
  TCompleteReturn,
> = (options: {
  job: ResolvedChainJobs<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>;
  complete: <
    TJobTypeName extends JobTypeChainNames<TJobTypeDefinitions, TChainTypeName> & string,
    TReturn extends
      | JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "output">
      | ContinuationJobs<
          GetStateAdapterJobId<TStateAdapter>,
          TJobTypeDefinitions,
          TJobTypeName,
          TChainTypeName
        >
      | Promise<JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "output">>
      | Promise<
          ContinuationJobs<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TJobTypeName,
            TChainTypeName
          >
        >,
  >(
    ...args: true extends IsUnion<TJobTypeName>
      ? [job: "Error: narrow the job type before calling complete (e.g. check job.typeName)"]
      : [
          job: ResolvedJob<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TJobTypeName,
            TChainTypeName
          >,
          completeCallback: (
            completeOptions: AttemptCompleteOptions<
              TStateAdapter,
              TJobTypeDefinitions,
              TJobTypeName,
              TChainTypeName
            >,
          ) => TReturn,
        ]
  ) => Promise<Awaited<TReturn>>;
}) => Promise<TCompleteReturn>;

type _CompleteJobChainResult<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends JobTypeNames<TJobTypeDefinitions>,
  TCompleteReturn,
> = [TCompleteReturn] extends [void]
  ? ResolvedJobChain<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>
  : TCompleteReturn extends Job<any, any, any, any, any> &
        ({ status: "pending" } | { status: "blocked" })
    ? ResolvedJobChain<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>
    : JobChain<
        GetStateAdapterJobId<TStateAdapter>,
        TChainTypeName,
        JobTypeProperty<TJobTypeDefinitions, TChainTypeName, "input">,
        TCompleteReturn
      > & { status: "completed" };

type _StartJobChainEntry<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
> = {
  typeName: TTypeName;
  input: JobTypeProperty<TJobTypeDefinitions, TTypeName, "input">;
  deduplication?: DeduplicationOptions;
  schedule?: ScheduleOptions;
} & (JobTypeHasBlockers<TJobTypeDefinitions, TTypeName> extends true
  ? { blockers: BlockerChains<TJobId, TJobTypeDefinitions, TTypeName> }
  : { blockers?: never });

type _AnyStartJobChainEntry<TJobId, TJobTypeDefinitions extends BaseJobTypeDefinitions> = {
  [TN in JobTypeEntryNames<TJobTypeDefinitions>]: _StartJobChainEntry<
    TJobId,
    TJobTypeDefinitions,
    TN
  >;
}[JobTypeEntryNames<TJobTypeDefinitions>];

type _StartJobChainsResult<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChains extends readonly unknown[],
> = {
  -readonly [K in keyof TChains]: TChains[K] extends {
    typeName: infer TN extends JobTypeNames<TJobTypeDefinitions>;
  }
    ? ResolvedJobChain<TJobId, TJobTypeDefinitions, TN> & { deduplicated: boolean }
    : never;
};

/**
 * The public API for managing job chains. Created via {@link createClient}.
 *
 * Methods are split into two categories:
 * - **Mutating** — `startJobChain`, `startJobChains`, `completeJobChain`, `deleteJobChains`, `triggerJob`. Require `transactionHooks` and a transaction context.
 * - **Read-only** — `getJobChain`, `getJob`, `listJobChains`, `listJobs`, `listJobChainJobs`, `getJobBlockers`, `listBlockedJobs`, `awaitJobChain`. Accept an optional transaction context.
 */
export type Client<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
  TJobId = GetStateAdapterJobId<TStateAdapter>,
> = {
  readonly [helpersSymbol]: Helpers;

  /** Create a new job chain. Returns the created chain with a `deduplicated` flag. */
  startJobChain: <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
    options: _StartJobChainEntry<TJobId, TJobTypeDefinitions, TChainTypeName> & {
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    ResolvedJobChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
      deduplicated: boolean;
    }
  >;

  /** Create multiple job chains in a single batch operation. Returns created chains with `deduplicated` flags, in the same order as input. */
  startJobChains: <
    const TChains extends readonly _AnyStartJobChainEntry<TJobId, TJobTypeDefinitions>[],
  >(
    options: {
      items: TChains;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<_StartJobChainsResult<TJobId, TJobTypeDefinitions, TChains>>;

  /** Delete job chains by ID. Throws {@link BlockerReferenceError} if external jobs depend on them. When `cascade` is true, includes transitive dependencies. */
  deleteJobChains: (
    options: {
      ids: TJobId[];
      cascade?: boolean;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    ResolvedJobChain<TJobId, TJobTypeDefinitions, JobTypeEntryNames<TJobTypeDefinitions>>[]
  >;

  /** Trigger a pending job immediately by setting its scheduledAt to now. Throws {@link JobNotFoundError} if the job does not exist, {@link JobNotTriggerableError} if the job is not pending. */
  triggerJob: (
    options: {
      id: TJobId;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<ResolvedJob<TJobId, TJobTypeDefinitions, JobTypeNames<TJobTypeDefinitions>>>;

  /** Complete a job chain from outside a worker. Validates `typeName`, then passes the current job and a `complete` function to the caller. */
  completeJobChain: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
    TCompleteReturn,
  >(
    options: {
      typeName: TChainTypeName;
      id: TJobId;
      transactionHooks: TransactionHooks;
      complete: _JobChainCompleteOptions<
        TStateAdapter,
        TJobTypeDefinitions,
        TChainTypeName,
        TCompleteReturn
      >;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    _CompleteJobChainResult<TStateAdapter, TJobTypeDefinitions, TChainTypeName, TCompleteReturn>
  >;

  /** Wait for a job chain to complete. Combines polling with notify adapter events. Throws {@link WaitChainTimeoutError} on timeout or abort. */
  awaitJobChain: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
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
  ) => Promise<
    ResolvedJobChain<TJobId, TJobTypeDefinitions, TChainTypeName> & { status: "completed" }
  >;

  /** Get a single job chain by ID. Pass `typeName` for type narrowing — throws {@link JobTypeMismatchError} on mismatch. */
  getJobChain: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TChainTypeName;
      id: TJobId;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<ResolvedJobChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined>;

  /** Get a single job by ID. Pass `typeName` for type narrowing — throws {@link JobTypeMismatchError} on mismatch. */
  getJob: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TJobTypeName;
      id: TJobId;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName> | undefined>;

  /**
   * List job chains with filtering and cursor-based pagination. Defaults to newest first.
   *
   * @remarks
   * Filtering by `status` alone is not optimized — it applies to the last job in the chain
   * and cannot use an index. Always combine with `typeName` or a date range (`from`/`to`).
   */
  listJobChains: <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
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
  ) => Promise<Page<ResolvedJobChain<TJobId, TJobTypeDefinitions, TChainTypeName>>>;

  /** List jobs with filtering and cursor-based pagination. Blockers are not populated — use {@link Client.getJobBlockers | getJobBlockers} for a specific job. Defaults to newest first. */
  listJobs: <TJobTypeName extends JobTypeNames<TJobTypeDefinitions>>(
    options: {
      filter?: {
        typeName?: TJobTypeName[];
        status?: JobStatus[];
        id?: TJobId[];
        jobChainTypeName?: JobTypeEntryNames<TJobTypeDefinitions>[];
        jobChainId?: TJobId[];
        from?: Date;
        to?: Date;
      };
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<Page<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>>>;

  /** List jobs within a specific chain, ordered by `chainIndex`. Defaults to ascending order. */
  listJobChainJobs: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      jobChainId: TJobId;
      typeName?: TChainTypeName;
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<Page<ResolvedChainJobs<TJobId, TJobTypeDefinitions, TChainTypeName>>>;

  /** Get the blocker chains for a specific job. Not paginated — blockers are bounded by design. Pass `typeName` for type narrowing. */
  getJobBlockers: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      jobId: TJobId;
      typeName?: TJobTypeName;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<BlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName>>;

  /** List jobs from other chains that are blocked by a given chain. Useful for understanding downstream impact before deletion. */
  listBlockedJobs: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
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
        TJobTypeDefinitions,
        JobTypeBlockedNames<TJobTypeDefinitions, TChainTypeName> & JobTypeNames<TJobTypeDefinitions>
      >
    >
  >;
};

/**
 * Create a new Queuert client.
 *
 * @param options.stateAdapter - Database adapter for job persistence.
 * @param options.notifyAdapter - Optional pub/sub adapter for real-time notifications.
 * @param options.observabilityAdapter - Optional adapter for metrics and tracing.
 * @param options.jobTypeRegistry - Job type registry (from {@link defineJobTypeRegistry} or {@link createJobTypeRegistry}).
 * @param options.log - Optional structured log function.
 */
export const createClient = async <
  TJobTypeRegistry extends JobTypeRegistry<any>,
  TStateAdapter extends StateAdapter<any, any>,
>({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  jobTypeRegistry: jobTypeRegistryOption,
  log,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  jobTypeRegistry: TJobTypeRegistry;
  log?: Log;
}): Promise<Client<JobTypeRegistryDefinitions<TJobTypeRegistry>, TStateAdapter>> => {
  type TJobTypeDefinitions = JobTypeRegistryDefinitions<TJobTypeRegistry>;
  type TJobId = GetStateAdapterJobId<TStateAdapter>;

  const helpers = createHelpers({
    stateAdapter: stateAdapterOption,
    notifyAdapter: notifyAdapterOption,
    observabilityAdapter: observabilityAdapterOption,
    jobTypeRegistry: jobTypeRegistryOption,
    log,
  });
  const client: Client<TJobTypeDefinitions, TStateAdapter> = {
    [helpersSymbol]: helpers,

    /** Create a new job chain. Returns the created chain with a `deduplicated` flag. */
    startJobChain: async <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
      options: {
        typeName: TChainTypeName;
        input: JobTypeProperty<TJobTypeDefinitions, TChainTypeName, "input">;
        transactionHooks: TransactionHooks;
        deduplication?: DeduplicationOptions;
        schedule?: ScheduleOptions;
      } & (JobTypeHasBlockers<TJobTypeDefinitions, TChainTypeName> extends true
        ? {
            blockers: BlockerChains<TJobId, TJobTypeDefinitions, TChainTypeName>;
          }
        : { blockers?: never }) &
        GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<
      ResolvedJobChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
        deduplicated: boolean;
      }
    > => {
      const { input, typeName, deduplication, schedule, blockers, transactionHooks, ...txCtx } =
        options;
      const [result] = await startJobChains(helpers, {
        jobChains: [{ typeName, input, deduplication, schedule, blockers }],
        txCtx,
        transactionHooks,
      });
      return result as ResolvedJobChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
        deduplicated: boolean;
      };
    },

    /** Create multiple job chains in a single batch operation. Returns created chains with `deduplicated` flags, in the same order as input. */
    startJobChains: async <
      const TChains extends readonly _AnyStartJobChainEntry<TJobId, TJobTypeDefinitions>[],
    >(
      options: {
        items: TChains;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<_StartJobChainsResult<TJobId, TJobTypeDefinitions, TChains>> => {
      const { items, transactionHooks, ...txCtx } = options;
      return (await startJobChains(helpers, {
        jobChains: items,
        txCtx,
        transactionHooks,
      })) as _StartJobChainsResult<TJobId, TJobTypeDefinitions, TChains>;
    },

    /** Delete job chains by ID. Throws {@link BlockerReferenceError} if external jobs depend on them. When `cascade` is true, includes transitive dependencies. */
    deleteJobChains: async (
      options: {
        ids: TJobId[];
        cascade?: boolean;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<
      ResolvedJobChain<TJobId, TJobTypeDefinitions, JobTypeEntryNames<TJobTypeDefinitions>>[]
    > => {
      const { ids, cascade, transactionHooks, ...txCtx } = options;

      const deletedChainPairs = await helpers.stateAdapter.deleteJobChains({
        txCtx,
        chainIds: ids,
        cascade,
      });

      const deletedChains = deletedChainPairs.map(
        (pair) =>
          mapStateJobPairToJobChain(pair) as ResolvedJobChain<
            TJobId,
            TJobTypeDefinitions,
            JobTypeEntryNames<TJobTypeDefinitions>
          >,
      );

      for (const pair of deletedChainPairs) {
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.jobChainDeleted(pair[0]);
        });
      }

      return deletedChains;
    },

    /** Trigger a pending job immediately by setting its scheduledAt to now. Throws {@link JobNotFoundError} if the job does not exist, {@link JobNotTriggerableError} if the job is not pending. */
    triggerJob: async (
      options: {
        id: TJobId;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<ResolvedJob<TJobId, TJobTypeDefinitions, JobTypeNames<TJobTypeDefinitions>>> => {
      const { id, transactionHooks, ...txCtx } = options;

      const existing = await helpers.stateAdapter.getJobForUpdate({ txCtx, jobId: id });
      if (!existing) {
        throw new JobNotFoundError(`Job with id ${String(id)} not found`, {
          jobId: id as string,
        });
      }
      if (existing.status !== "pending") {
        throw new JobNotTriggerableError(
          `Cannot trigger job ${String(id)}: job status is "${existing.status}", must be "pending"`,
          { jobId: id as string, status: existing.status },
        );
      }

      const job = await helpers.stateAdapter.triggerJob({ txCtx, jobId: id });
      bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, job);
      bufferObservabilityEvent(transactionHooks, () => {
        helpers.observabilityHelper.jobTriggered(job);
      });
      return mapStateJobToJob(job) as ResolvedJob<
        TJobId,
        TJobTypeDefinitions,
        JobTypeNames<TJobTypeDefinitions>
      >;
    },

    /** Complete a job chain from outside a worker. Validates `typeName`, then passes the current job and a `complete` function to the caller. */
    completeJobChain: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
      TCompleteReturn,
    >(
      options: {
        typeName: TChainTypeName;
        id: TJobId;
        transactionHooks: TransactionHooks;
        complete: _JobChainCompleteOptions<
          TStateAdapter,
          TJobTypeDefinitions,
          TChainTypeName,
          TCompleteReturn
        >;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<
      _CompleteJobChainResult<TStateAdapter, TJobTypeDefinitions, TChainTypeName, TCompleteReturn>
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

        let continuedJob: Job<any, any, any, any, any> | null = null;

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

      return mapStateJobPairToJobChain(updatedChain) as _CompleteJobChainResult<
        TStateAdapter,
        TJobTypeDefinitions,
        TChainTypeName,
        TCompleteReturn
      >;
    },

    /** Wait for a job chain to complete. Combines polling with notify adapter events. Throws {@link WaitChainTimeoutError} on timeout or abort. */
    awaitJobChain: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
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
      ResolvedJobChain<TJobId, TJobTypeDefinitions, TChainTypeName> & { status: "completed" }
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
          ? (mapped as ResolvedJobChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
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
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName?: TChainTypeName;
        id: TJobId;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<ResolvedJobChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined> => {
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
        TJobTypeDefinitions,
        TChainTypeName
      >;
    },

    /** Get a single job by ID. Pass `typeName` for type narrowing — throws {@link JobTypeMismatchError} on mismatch. */
    getJob: async <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName?: TJobTypeName;
        id: TJobId;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName> | undefined> => {
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

      return mapStateJobToJob(job) as ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>;
    },
    /**
     * List job chains with filtering and cursor-based pagination. Defaults to newest first.
     *
     * @remarks
     * Filtering by `status` alone is not optimized — it applies to the last job in the chain
     * and cannot use an index. Always combine with `typeName` or a date range (`from`/`to`).
     */
    listJobChains: async <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
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
    ): Promise<Page<ResolvedJobChain<TJobId, TJobTypeDefinitions, TChainTypeName>>> => {
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
              TJobTypeDefinitions,
              TChainTypeName
            >,
        ),
        nextCursor: result.nextCursor,
      };
    },

    /** List jobs with filtering and cursor-based pagination. Blockers are not populated — use `getJobBlockers` for a specific job. Defaults to newest first. */
    listJobs: async <TJobTypeName extends JobTypeNames<TJobTypeDefinitions>>(
      options: {
        filter?: {
          typeName?: TJobTypeName[];
          status?: JobStatus[];
          id?: TJobId[];
          jobChainTypeName?: JobTypeEntryNames<TJobTypeDefinitions>[];
          jobChainId?: TJobId[];
          from?: Date;
          to?: Date;
        };
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>>> => {
      const { filter, orderDirection = "desc", cursor, limit = 50, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);
      const result = await helpers.stateAdapter.listJobs({
        txCtx,
        filter: {
          typeName: filter?.typeName,
          chainTypeName: filter?.jobChainTypeName,
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
          (job) => mapStateJobToJob(job) as ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>,
        ),
        nextCursor: result.nextCursor,
      };
    },

    /** List jobs within a specific chain, ordered by `chainIndex`. Defaults to ascending order. */
    listJobChainJobs: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        jobChainId: TJobId;
        typeName?: TChainTypeName;
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<ResolvedChainJobs<TJobId, TJobTypeDefinitions, TChainTypeName>>> => {
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
            mapStateJobToJob(job) as ResolvedChainJobs<TJobId, TJobTypeDefinitions, TChainTypeName>,
        ),
        nextCursor: result.nextCursor,
      };
    },

    /** Get the blocker chains for a specific job. Not paginated — blockers are bounded by design. Pass `typeName` for type narrowing. */
    getJobBlockers: async <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
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

    /** List jobs from other chains that are blocked by a given chain. Useful for understanding downstream impact before deletion. */
    listBlockedJobs: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
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
          TJobTypeDefinitions,
          JobTypeBlockedNames<TJobTypeDefinitions, TChainTypeName> &
            JobTypeNames<TJobTypeDefinitions>
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
              TJobTypeDefinitions,
              JobTypeBlockedNames<TJobTypeDefinitions, TChainTypeName> &
                JobTypeNames<TJobTypeDefinitions>
            >,
        ),
        nextCursor: result.nextCursor,
      };
    },
  };
  return client;
};
