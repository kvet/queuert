import { type DeduplicationOptions } from "./entities/deduplication.js";
import { type JobChain, mapStateJobPairToJobChain } from "./entities/job-chain.js";
import { type BaseJobTypeDefinitions } from "./entities/job-type.js";
import { type JobTypes, type JobTypeDefinitions } from "./entities/job-types.js";
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
} from "./entities/job-types.resolvers.js";
import { type Job, type JobStatus, mapStateJobToJob } from "./entities/job.js";
import {
  type MergeDefinitions,
  type ValidatedSlices,
  mergeJobTypes,
} from "./entities/merge-job-types.js";
import { type ScheduleOptions } from "./entities/schedule.js";
import {
  BlockerReferenceError,
  JobAlreadyCompletedError,
  JobChainNotFoundError,
  JobNotFoundError,
  JobNotTriggerableError,
  JobTypeMismatchError,
  TransactionContextRequiredError,
  WaitChainTimeoutError,
} from "./errors.js";
import { bufferNotifyJobOwnershipLost, bufferNotifyJobScheduled } from "./helpers/notify-hooks.js";
import { bufferObservabilityEvent } from "./helpers/observability-hooks.js";
import { raceWithSleep } from "./helpers/sleep.js";
import { type IsUnion } from "./helpers/typescript.js";
import { continueWith } from "./implementation/continue-with.js";
import { finishJob } from "./implementation/finish-job.js";
import { startJobChains } from "./implementation/start-job-chains.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { type Log } from "./observability-adapter/log.js";
import { type ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import { type OrderDirection, type Page } from "./pagination.js";
import { type Helpers, createHelpers } from "./setup-helpers.js";
import {
  type BaseTxContext,
  type GetStateAdapterJobId,
  type GetStateAdapterTxContext,
  type StateAdapter,
  type StateJob,
} from "./state-adapter/state-adapter.js";
import { type TransactionHooks } from "./transaction-hooks.js";
import { type AttemptCompleteOptions } from "./worker/job-process.js";

/** @internal Used by `createInProcessWorker` and `createDashboard` to access client internals. Not part of the public API. */
export const helpersSymbol: unique symbol = Symbol("queuert.helpers");

const normalizeTxCtx = <T extends Record<string, unknown>>(rest: T): T | undefined =>
  Object.keys(rest).length > 0 ? rest : undefined;

const requireTxCtx = <T extends Record<string, unknown>>(rest: T): T => {
  if (Object.keys(rest).length === 0) {
    throw new TransactionContextRequiredError(
      "Mutating client methods require a transaction context from withTransaction",
    );
  }
  return rest;
};

type JobChainCompleteOptions<
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

type CompleteJobChainResult<
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

type CompleteJobChainResultFromComplete<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends JobTypeNames<TJobTypeDefinitions>,
  TComplete,
> = TComplete extends (...args: any[]) => Promise<infer TCompleteReturn>
  ? CompleteJobChainResult<TStateAdapter, TJobTypeDefinitions, TChainTypeName, TCompleteReturn>
  : never;

type StartJobChainEntry<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
> = {
  typeName: TTypeName;
  input: JobTypeProperty<TJobTypeDefinitions, TTypeName, "input">;
  deduplication?: DeduplicationOptions<TJobId>;
  schedule?: ScheduleOptions;
} & (JobTypeHasBlockers<TJobTypeDefinitions, TTypeName> extends true
  ? { blockers: BlockerChains<TJobId, TJobTypeDefinitions, TTypeName> }
  : { blockers?: never });

type AnyStartJobChainEntry<TJobId, TJobTypeDefinitions extends BaseJobTypeDefinitions> = {
  [TN in JobTypeEntryNames<TJobTypeDefinitions>]: StartJobChainEntry<
    TJobId,
    TJobTypeDefinitions,
    TN
  >;
}[JobTypeEntryNames<TJobTypeDefinitions>];

type StartJobChainsResult<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChains extends readonly unknown[],
> = {
  -readonly [K in keyof TChains]: TChains[K] extends {
    typeName: infer TN extends string;
  }
    ? ResolvedJobChain<TJobId, TJobTypeDefinitions, TN> & { deduplicated: boolean }
    : never;
};

/**
 * The public API for managing job chains. Created via {@link createClient}.
 *
 * Methods are split into two categories:
 * - **Mutating** — `startJobChain`, `startJobChains`, `completeJobChain`, `deleteJobChain`, `deleteJobChains`, `triggerJob`, `triggerJobs`. Require `transactionHooks` and a transaction context.
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
    options: StartJobChainEntry<TJobId, TJobTypeDefinitions, TChainTypeName> & {
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    ResolvedJobChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
      deduplicated: boolean;
    }
  >;

  /** Create multiple job chains in a single batch operation. Returns created chains with `deduplicated` flags, in the same order as input. */
  startJobChains: <
    const TChains extends readonly AnyStartJobChainEntry<TJobId, TJobTypeDefinitions>[],
  >(
    options: {
      items: TChains;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<StartJobChainsResult<TJobId, TJobTypeDefinitions, TChains>>;

  /** Delete a single job chain by ID. Returns the deleted chain, or `undefined` if no chain with that ID exists. Throws {@link BlockerReferenceError} if external jobs depend on it. When `cascade` is true, includes transitive dependencies. */
  deleteJobChain: <
    TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      id: TJobId;
      cascade?: boolean;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<ResolvedJobChain<TJobId, TJobTypeDefinitions, TEntryName> | undefined>;

  /** Delete job chains by ID. Missing IDs are silently skipped. Throws {@link BlockerReferenceError} if external jobs depend on them. When `cascade` is true, includes transitive dependencies. */
  deleteJobChains: <
    TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      ids: TJobId[];
      cascade?: boolean;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<ResolvedJobChain<TJobId, TJobTypeDefinitions, TEntryName>[]>;

  /** Trigger a pending job immediately by setting its scheduledAt to now. Throws {@link JobNotFoundError} if the job does not exist, {@link JobNotTriggerableError} if the job is not pending. */
  triggerJob: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      id: TJobId;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>>;

  /** Trigger multiple pending jobs immediately. Validation is atomic: throws {@link JobNotFoundError} or {@link JobNotTriggerableError} for the first invalid job before any job is triggered. Returns jobs in input order. Empty `ids` returns `[]`. */
  triggerJobs: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      ids: TJobId[];
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>[]>;

  /** Complete a job chain from outside a worker. Validates `typeName`, then passes the current job and a `complete` function to the caller. */
  completeJobChain: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
    TComplete extends (...args: any[]) => Promise<any> = JobChainCompleteOptions<
      TStateAdapter,
      TJobTypeDefinitions,
      TChainTypeName,
      any
    >,
    TResult = CompleteJobChainResultFromComplete<
      TStateAdapter,
      TJobTypeDefinitions,
      TChainTypeName,
      TComplete
    >,
  >(
    options: {
      typeName: TChainTypeName;
      id: TJobId;
      transactionHooks: TransactionHooks;
      complete: TComplete;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<TResult>;

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
    TBlockers extends readonly unknown[] = BlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName>,
  >(
    options: {
      jobId: TJobId;
      typeName?: TJobTypeName;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<TBlockers>;

  /** List jobs from other chains that are blocked by a given chain. Useful for understanding downstream impact before deletion. */
  listBlockedJobs: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
    TBlockedJob = ResolvedJob<
      TJobId,
      TJobTypeDefinitions,
      JobTypeBlockedNames<TJobTypeDefinitions, TChainTypeName> & JobTypeNames<TJobTypeDefinitions>
    >,
  >(
    options: {
      jobChainId: TJobId;
      typeName?: TChainTypeName;
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<Page<TBlockedJob>>;
};

/** Derive TJobTypeDefinitions from a single slice or an array of slices. @internal */
type ClientDefinitions<T> = T extends readonly JobTypes<any>[]
  ? MergeDefinitions<T>
  : T extends JobTypes<any>
    ? JobTypeDefinitions<T>
    : never;

/**
 * Create a new Queuert client.
 *
 * @param options.stateAdapter - Database adapter for job persistence.
 * @param options.notifyAdapter - Optional pub/sub adapter for real-time notifications.
 * @param options.observabilityAdapter - Optional adapter for metrics and tracing.
 * @param options.jobTypes - A single JobTypes slice, or an array of slices to merge. Slices are built with {@link defineJobTypes} or {@link createJobTypes}.
 * @param options.log - Optional structured log function.
 */
export const createClient = async <
  const TJobTypesInput extends JobTypes<any> | readonly [JobTypes<any>, ...JobTypes<any>[]],
  TStateAdapter extends StateAdapter<any, any>,
>({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  jobTypes: jobTypesOption,
  log,
}: {
  stateAdapter: TStateAdapter;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  jobTypes: TJobTypesInput extends readonly JobTypes<any>[]
    ? ValidatedSlices<TJobTypesInput> & TJobTypesInput
    : TJobTypesInput;
  log?: Log;
}): Promise<Client<ClientDefinitions<TJobTypesInput>, TStateAdapter>> => {
  type TJobTypeDefinitions = ClientDefinitions<TJobTypesInput>;
  type TJobId = GetStateAdapterJobId<TStateAdapter>;

  const jobTypes = Array.isArray(jobTypesOption)
    ? jobTypesOption.length === 1
      ? (jobTypesOption[0] as JobTypes<any>)
      : // ValidatedSlices duplicate-check is enforced at the createClient signature;
        // internal cast bypasses it since the input is already validated.
        mergeJobTypes(jobTypesOption as never)
    : (jobTypesOption as JobTypes<any>);

  const helpers = createHelpers({
    stateAdapter: stateAdapterOption,
    notifyAdapter: notifyAdapterOption,
    observabilityAdapter: observabilityAdapterOption,
    jobTypes,
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
        deduplication?: DeduplicationOptions<TJobId>;
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
      const { input, typeName, deduplication, schedule, blockers, transactionHooks, ...rest } =
        options;
      const txCtx = requireTxCtx(rest);
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
      const TChains extends readonly AnyStartJobChainEntry<TJobId, TJobTypeDefinitions>[],
    >(
      options: {
        items: TChains;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<StartJobChainsResult<TJobId, TJobTypeDefinitions, TChains>> => {
      const { items, transactionHooks, ...rest } = options;
      const txCtx = requireTxCtx(rest);
      return (await startJobChains(helpers, {
        jobChains: items,
        txCtx,
        transactionHooks,
      })) as StartJobChainsResult<TJobId, TJobTypeDefinitions, TChains>;
    },

    /** Delete a single job chain by ID. Returns the deleted chain, or `undefined` if no chain with that ID exists. Throws {@link BlockerReferenceError} if external jobs depend on it. When `cascade` is true, includes transitive dependencies. */
    deleteJobChain: async <
      TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        id: TJobId;
        cascade?: boolean;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<ResolvedJobChain<TJobId, TJobTypeDefinitions, TEntryName> | undefined> => {
      const { id, cascade, transactionHooks, ...rest } = options;
      const deleted = await client.deleteJobChains<TEntryName>({
        ids: [id],
        cascade,
        transactionHooks,
        ...(rest as GetStateAdapterTxContext<TStateAdapter>),
      });

      return deleted.find((chain) => chain.id === id);
    },

    /** Delete job chains by ID. Missing IDs are silently skipped. Throws {@link BlockerReferenceError} if external jobs depend on them. When `cascade` is true, includes transitive dependencies. */
    deleteJobChains: async <
      TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        ids: TJobId[];
        cascade?: boolean;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<ResolvedJobChain<TJobId, TJobTypeDefinitions, TEntryName>[]> => {
      const { ids, cascade, transactionHooks, ...rest } = options;
      const txCtx = requireTxCtx(rest);

      const { deleted, blockerRefs } = await helpers.stateAdapter.deleteJobChains({
        txCtx,
        chainIds: ids,
        cascade,
      });

      if (blockerRefs.length > 0) {
        throw new BlockerReferenceError(
          `Cannot delete chains: ${[...new Set(blockerRefs.map((r) => r.chainId))].join(", ")} referenced as blockers`,
          { references: blockerRefs },
        );
      }

      const deletedChains = deleted.map(
        (pair) =>
          mapStateJobPairToJobChain(pair) as ResolvedJobChain<
            TJobId,
            TJobTypeDefinitions,
            TEntryName
          >,
      );

      for (const pair of deleted) {
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.jobChainDeleted(pair[0]);
        });
      }

      return deletedChains;
    },

    /** Trigger a pending job immediately by setting its scheduledAt to now. Throws {@link JobNotFoundError} if the job does not exist, {@link JobNotTriggerableError} if the job is not pending. */
    triggerJob: async <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: {
        id: TJobId;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>> => {
      const { id, transactionHooks, ...rest } = options;
      const [job] = await client.triggerJobs<TJobTypeName>({
        ids: [id],
        transactionHooks,
        ...(rest as GetStateAdapterTxContext<TStateAdapter>),
      });
      return job;
    },

    /** Trigger multiple pending jobs immediately. Validation is atomic: throws {@link JobNotFoundError} or {@link JobNotTriggerableError} for the first invalid job before any job is triggered. Returns jobs in input order. Empty `ids` returns `[]`. */
    triggerJobs: async <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: {
        ids: TJobId[];
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>[]> => {
      const { ids, transactionHooks, ...rest } = options;
      const txCtx = requireTxCtx(rest);

      if (ids.length === 0) return [];

      const { triggered, notFound, notTriggerable } = await helpers.stateAdapter.triggerJobs({
        txCtx,
        jobIds: ids,
      });

      if (notFound.length > 0) {
        const id = notFound[0];
        throw new JobNotFoundError(`Job with id ${String(id)} not found`, {
          jobId: id as string,
        });
      }
      if (notTriggerable.length > 0) {
        const { id, status } = notTriggerable[0];
        throw new JobNotTriggerableError(
          `Cannot trigger job ${String(id)}: job status is "${status}", must be "pending"`,
          { jobId: id as string, status },
        );
      }

      for (const job of triggered) {
        bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, job);
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.jobTriggered(job);
        });
      }

      return triggered.map(
        (job) => mapStateJobToJob(job) as ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>,
      );
    },

    /** Complete a job chain from outside a worker. Validates `typeName`, then passes the current job and a `complete` function to the caller. */
    completeJobChain: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
      TComplete extends (...args: any[]) => Promise<any> = JobChainCompleteOptions<
        TStateAdapter,
        TJobTypeDefinitions,
        TChainTypeName,
        any
      >,
      TResult = CompleteJobChainResultFromComplete<
        TStateAdapter,
        TJobTypeDefinitions,
        TChainTypeName,
        TComplete
      >,
    >(
      options: {
        typeName: TChainTypeName;
        id: TJobId;
        transactionHooks: TransactionHooks;
        complete: TComplete;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<TResult> => {
      const { id, typeName, complete: completeCallback, transactionHooks, ...rest } = options;
      const txCtx = requireTxCtx(rest);
      const jobChainPair = await helpers.stateAdapter.getJobChainById({
        txCtx,
        chainId: id,
        lock: "exclusive",
      });

      if (!jobChainPair) {
        throw new JobChainNotFoundError(`Job chain with id ${id} not found`, {
          chainId: id as string,
        });
      }

      const [rootJob, lastJob] = jobChainPair;
      const currentJob = lastJob ?? rootJob;

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

      return mapStateJobPairToJobChain(updatedChain) as TResult;
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

      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => {
        timeoutController.abort(
          new WaitChainTimeoutError(
            `Timeout waiting for job chain ${id} to complete after ${timeoutMs}ms`,
            { chainId: id as string, timeoutMs },
          ),
        );
      }, timeoutMs);
      const timeoutSignal = timeoutController.signal;
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
        try {
          dispose = await helpers.notifyAdapter.listenJobChainCompleted(id, () => {
            resolveNotification?.();
          });
        } catch {}

        const completedChain = await checkChain();
        if (completedChain) return completedChain;

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
        clearTimeout(timeoutId);
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
      TBlockers extends readonly unknown[] = BlockerChains<
        TJobId,
        TJobTypeDefinitions,
        TJobTypeName
      >,
    >(
      options: {
        jobId: TJobId;
        typeName?: TJobTypeName;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<TBlockers> => {
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
      return blockers.map((pair) => mapStateJobPairToJobChain(pair)) as unknown as TBlockers;
    },

    /** List jobs from other chains that are blocked by a given chain. Useful for understanding downstream impact before deletion. */
    listBlockedJobs: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
      TBlockedJob = ResolvedJob<
        TJobId,
        TJobTypeDefinitions,
        JobTypeBlockedNames<TJobTypeDefinitions, TChainTypeName> & JobTypeNames<TJobTypeDefinitions>
      >,
    >(
      options: {
        jobChainId: TJobId;
        typeName?: TChainTypeName;
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<TBlockedJob>> => {
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
        items: result.items.map((job) => mapStateJobToJob(job) as TBlockedJob),
        nextCursor: result.nextCursor,
      };
    },
  };
  return client;
};
