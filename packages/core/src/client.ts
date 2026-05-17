import { type Chain, mapStatePairToChain } from "./entities/chain.js";
import { type DeduplicationOptions } from "./entities/deduplication.js";
import { type BaseJobTypeDefinitions } from "./entities/job-type.js";
import { type JobTypes } from "./entities/job-types.js";
import {
  type BlockerChains,
  type ContinuationJobs,
  type JobTypeBlockedNames,
  type JobTypeChainNames,
  type JobTypeEntryNames,
  type JobTypeHasBlockers,
  type JobTypeNames,
  type JobTypeProperty,
  type ResolvedChain,
  type ResolvedChainJobs,
  type ResolvedJob,
} from "./entities/job-types.resolvers.js";
import { type Job, type JobStatus, mapStateJobToJob } from "./entities/job.js";
import {
  type JobTypesDefinitions,
  type ValidatedSlices,
  mergeJobTypes,
} from "./entities/merge-job-types.js";
import { type ScheduleOptions } from "./entities/schedule.js";
import {
  BlockerReferenceError,
  ChainNotFoundError,
  JobAlreadyCompletedError,
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
import { startChains } from "./implementation/start-chains.js";
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

type ChainCompleteOptions<
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

type CompleteChainResult<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends JobTypeNames<TJobTypeDefinitions>,
  TCompleteReturn,
> = [TCompleteReturn] extends [void]
  ? ResolvedChain<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>
  : TCompleteReturn extends Job<any, any, any, any, any> &
        ({ status: "pending" } | { status: "blocked" })
    ? ResolvedChain<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>
    : Chain<
        GetStateAdapterJobId<TStateAdapter>,
        TChainTypeName,
        JobTypeProperty<TJobTypeDefinitions, TChainTypeName, "input">,
        TCompleteReturn
      > & { status: "completed" };

type CompleteChainResultFromComplete<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends JobTypeNames<TJobTypeDefinitions>,
  TComplete,
> = TComplete extends (...args: any[]) => Promise<infer TCompleteReturn>
  ? CompleteChainResult<TStateAdapter, TJobTypeDefinitions, TChainTypeName, TCompleteReturn>
  : never;

type StartChainEntry<
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

type AnyStartChainEntry<TJobId, TJobTypeDefinitions extends BaseJobTypeDefinitions> = {
  [TN in JobTypeEntryNames<TJobTypeDefinitions>]: StartChainEntry<TJobId, TJobTypeDefinitions, TN>;
}[JobTypeEntryNames<TJobTypeDefinitions>];

type StartChainsResult<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChains extends readonly unknown[],
> = {
  -readonly [K in keyof TChains]: TChains[K] extends {
    typeName: infer TN extends string;
  }
    ? ResolvedChain<TJobId, TJobTypeDefinitions, TN> & { deduplicated: boolean }
    : never;
};

/**
 * The public API for managing chains. Created via {@link createClient}.
 *
 * Methods are split into two categories:
 * - **Mutating** — `startChain`, `startChains`, `completeChain`, `deleteChain`, `deleteChains`, `triggerJob`, `triggerJobs`. Require `transactionHooks` and a transaction context.
 * - **Read-only** — `getChain`, `getJob`, `listChains`, `listJobs`, `listChainJobs`, `getJobBlockers`, `listBlockedJobs`, `awaitChain`. Accept an optional transaction context.
 */
export type Client<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
  TJobId = GetStateAdapterJobId<TStateAdapter>,
> = {
  readonly [helpersSymbol]: Helpers;

  /** Create a new chain. Returns the created chain with a `deduplicated` flag. Throws {@link TransactionContextRequiredError} if called without a transaction context. */
  startChain: <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
    options: StartChainEntry<TJobId, TJobTypeDefinitions, TChainTypeName> & {
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
      deduplicated: boolean;
    }
  >;

  /** Create multiple chains in a single batch operation. Returns created chains with `deduplicated` flags, in the same order as input. Throws {@link TransactionContextRequiredError} if called without a transaction context. */
  startChains: <const TChains extends readonly AnyStartChainEntry<TJobId, TJobTypeDefinitions>[]>(
    options: {
      items: TChains;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<StartChainsResult<TJobId, TJobTypeDefinitions, TChains>>;

  /** Delete a single chain by ID. Returns the deleted chain, or `undefined` if no chain with that ID exists. Throws {@link BlockerReferenceError} if external jobs depend on it, {@link TransactionContextRequiredError} if called without a transaction context. When `cascade` is true, includes transitive dependencies. */
  deleteChain: <
    TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      id: TJobId;
      cascade?: boolean;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<ResolvedChain<TJobId, TJobTypeDefinitions, TEntryName> | undefined>;

  /** Delete chains by ID. Missing IDs are silently skipped. Throws {@link BlockerReferenceError} if external jobs depend on them, {@link TransactionContextRequiredError} if called without a transaction context. When `cascade` is true, includes transitive dependencies. */
  deleteChains: <
    TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      ids: TJobId[];
      cascade?: boolean;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<ResolvedChain<TJobId, TJobTypeDefinitions, TEntryName>[]>;

  /** Trigger a pending job immediately by setting its scheduledAt to now. Throws {@link JobNotFoundError} if the job does not exist, {@link JobNotTriggerableError} if the job is not pending, {@link TransactionContextRequiredError} if called without a transaction context. */
  triggerJob: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      id: TJobId;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>>;

  /** Trigger multiple pending jobs immediately. Validation is atomic: throws {@link JobNotFoundError} or {@link JobNotTriggerableError} for the first invalid job before any job is triggered, or {@link TransactionContextRequiredError} if called without a transaction context. Returns jobs in input order. Empty `ids` returns `[]`. */
  triggerJobs: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      ids: TJobId[];
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>[]>;

  /** Complete a chain from outside a worker. Validates `typeName`, then passes the current job and a `complete` function to the caller. Throws {@link ChainNotFoundError} if the chain does not exist, {@link JobTypeMismatchError} if the chain's type does not match `typeName`, {@link TransactionContextRequiredError} if called without a transaction context, and {@link JobAlreadyCompletedError} from the inner `complete` callback if the job is already completed. */
  completeChain: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
    TComplete extends (...args: any[]) => Promise<any> = ChainCompleteOptions<
      TStateAdapter,
      TJobTypeDefinitions,
      TChainTypeName,
      any
    >,
    TResult = CompleteChainResultFromComplete<
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

  /** Wait for a chain to complete. Combines polling with notify adapter events. Throws {@link WaitChainTimeoutError} on timeout or abort, {@link ChainNotFoundError} if the chain disappears or never existed, {@link JobTypeMismatchError} if `typeName` is provided and does not match. */
  awaitChain: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    chain: {
      typeName?: TChainTypeName;
      id: TJobId;
    },
    options: {
      timeoutMs: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
    },
  ) => Promise<
    ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & { status: "completed" }
  >;

  /** Get a single chain by ID. Pass `typeName` for type narrowing — throws {@link JobTypeMismatchError} on mismatch. */
  getChain: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TChainTypeName;
      id: TJobId;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined>;

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
   * List chains with filtering and cursor-based pagination. Defaults to newest first.
   *
   * @remarks
   * Filtering by `status` alone is not optimized — it applies to the last job in the chain
   * and cannot use an index. Always combine with `typeName` or a date range (`from`/`to`).
   */
  listChains: <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
    options: {
      filter?: {
        typeName?: TChainTypeName[];
        status?: JobStatus[];
        chainId?: TJobId[];
        jobId?: TJobId[];
        root?: boolean;
        from?: Date;
        to?: Date;
      };
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<Page<ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName>>>;

  /** List jobs with filtering and cursor-based pagination. Blockers are not populated — use {@link Client.getJobBlockers | getJobBlockers} for a specific job. Defaults to newest first. */
  listJobs: <TJobTypeName extends JobTypeNames<TJobTypeDefinitions>>(
    options: {
      filter?: {
        typeName?: TJobTypeName[];
        status?: JobStatus[];
        jobId?: TJobId[];
        chainTypeName?: JobTypeEntryNames<TJobTypeDefinitions>[];
        chainId?: TJobId[];
        from?: Date;
        to?: Date;
      };
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<Page<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>>>;

  /** List jobs within a specific chain, ordered by `chainIndex`. Defaults to ascending order. Pass `typeName` for type narrowing — throws {@link JobTypeMismatchError} on mismatch. */
  listChainJobs: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      chainId: TJobId;
      typeName?: TChainTypeName;
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<Page<ResolvedChainJobs<TJobId, TJobTypeDefinitions, TChainTypeName>>>;

  /** Get the blocker chains for a specific job. Not paginated — blockers are bounded by design. Pass `typeName` for type narrowing — throws {@link JobTypeMismatchError} on mismatch. */
  getJobBlockers: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    TBlockers extends readonly unknown[] = BlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName>,
  >(
    options: {
      jobId: TJobId;
      typeName?: TJobTypeName;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<TBlockers>;

  /** List jobs from other chains that are blocked by a given chain. Useful for understanding downstream impact before deletion. Pass `typeName` for type narrowing — throws {@link JobTypeMismatchError} on mismatch. */
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
      chainId: TJobId;
      typeName?: TChainTypeName;
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<Page<TBlockedJob>>;
};

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
  const TJobTypes extends JobTypes<any> | readonly [JobTypes<any>, ...JobTypes<any>[]],
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
  jobTypes: TJobTypes extends readonly JobTypes<any>[]
    ? ValidatedSlices<TJobTypes> & TJobTypes
    : TJobTypes;
  log?: Log;
}): Promise<Client<JobTypesDefinitions<TJobTypes>, TStateAdapter>> => {
  type TJobTypeDefinitions = JobTypesDefinitions<TJobTypes>;
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

    startChain: async <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
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
      ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
        deduplicated: boolean;
      }
    > => {
      const { input, typeName, deduplication, schedule, blockers, transactionHooks, ...rest } =
        options;
      const txCtx = requireTxCtx(rest);
      const [result] = await startChains(helpers, {
        chains: [{ typeName, input, deduplication, schedule, blockers }],
        txCtx,
        transactionHooks,
      });
      return result as ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
        deduplicated: boolean;
      };
    },

    startChains: async <
      const TChains extends readonly AnyStartChainEntry<TJobId, TJobTypeDefinitions>[],
    >(
      options: {
        items: TChains;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<StartChainsResult<TJobId, TJobTypeDefinitions, TChains>> => {
      const { items, transactionHooks, ...rest } = options;
      const txCtx = requireTxCtx(rest);
      return (await startChains(helpers, {
        chains: items,
        txCtx,
        transactionHooks,
      })) as StartChainsResult<TJobId, TJobTypeDefinitions, TChains>;
    },

    deleteChain: async <
      TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        id: TJobId;
        cascade?: boolean;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<ResolvedChain<TJobId, TJobTypeDefinitions, TEntryName> | undefined> => {
      const { id, cascade, transactionHooks, ...rest } = options;
      const deleted = await client.deleteChains<TEntryName>({
        ids: [id],
        cascade,
        transactionHooks,
        ...(rest as GetStateAdapterTxContext<TStateAdapter>),
      });

      return deleted.find((chain) => chain.id === id);
    },

    deleteChains: async <
      TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        ids: TJobId[];
        cascade?: boolean;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<ResolvedChain<TJobId, TJobTypeDefinitions, TEntryName>[]> => {
      const { ids, cascade, transactionHooks, ...rest } = options;
      const txCtx = requireTxCtx(rest);

      const { deleted, blockerRefs } = await helpers.stateAdapter.deleteChains({
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
          mapStatePairToChain(pair) as ResolvedChain<TJobId, TJobTypeDefinitions, TEntryName>,
      );

      for (const pair of deleted) {
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.chainDeleted(pair[0]);
        });
      }

      return deletedChains;
    },

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

    completeChain: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
      TComplete extends (...args: any[]) => Promise<any> = ChainCompleteOptions<
        TStateAdapter,
        TJobTypeDefinitions,
        TChainTypeName,
        any
      >,
      TResult = CompleteChainResultFromComplete<
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
      const chainPair = await helpers.stateAdapter.getChain({
        txCtx,
        chainId: id,
        lock: "exclusive",
      });

      if (!chainPair) {
        throw new ChainNotFoundError(`Chain with id ${id} not found`, {
          chainId: id as string,
        });
      }

      const [rootJob, lastJob] = chainPair;
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
              blockers?: Chain<any, any, any, any>[];
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

      const updatedChain = await helpers.stateAdapter.getChain({
        txCtx,
        chainId: id,
      });

      if (!updatedChain) {
        throw new ChainNotFoundError(`Chain with id ${id} not found after complete`, {
          chainId: id as string,
        });
      }

      return mapStatePairToChain(updatedChain) as TResult;
    },

    awaitChain: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      chain: {
        typeName?: TChainTypeName;
        id: TJobId;
      },
      options: {
        timeoutMs: number;
        pollIntervalMs?: number;
        signal?: AbortSignal;
      },
    ): Promise<
      ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & { status: "completed" }
    > => {
      const { id, typeName } = chain;
      const { timeoutMs, pollIntervalMs = 15_000, signal } = options;

      let typeValidated = !typeName;

      const checkChain = async () => {
        const chainPair = await helpers.stateAdapter.getChain({ chainId: id });
        if (!chainPair) {
          throw new ChainNotFoundError(`Chain with id ${id} not found`, {
            chainId: id as string,
          });
        }

        if (!typeValidated) {
          if (chainPair[0].chainTypeName !== typeName) {
            throw new JobTypeMismatchError(
              `Expected chain ${String(id)} to have type "${typeName}" but found "${chainPair[0].chainTypeName}"`,
              { expectedTypeName: typeName!, actualTypeName: chainPair[0].chainTypeName },
            );
          }
          typeValidated = true;
        }

        const mapped = mapStatePairToChain(chainPair);
        return mapped.status === "completed"
          ? (mapped as ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
              status: "completed";
            })
          : null;
      };

      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => {
        timeoutController.abort(
          new WaitChainTimeoutError(
            `Timeout waiting for chain ${id} to complete after ${timeoutMs}ms`,
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
          dispose = await helpers.notifyAdapter.listenChainCompleted(id, () => {
            resolveNotification?.();
          });
        } catch {}

        const completedChain = await checkChain();
        if (completedChain) return completedChain;

        while (!combinedSignal.aborted) {
          await raceWithSleep(notificationPromise, pollIntervalMs, { signal: combinedSignal });
          resetNotificationPromise();

          const chainResult = await checkChain();
          if (chainResult) return chainResult;

          if (combinedSignal.aborted) break;
        }

        throw new WaitChainTimeoutError(
          signal?.aborted
            ? `Wait for chain ${id} was aborted`
            : `Timeout waiting for chain ${id} to complete after ${timeoutMs}ms`,
          { chainId: id as string, timeoutMs, cause: signal?.reason },
        );
      } finally {
        clearTimeout(timeoutId);
        await dispose();
      }
    },

    getChain: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName?: TChainTypeName;
        id: TJobId;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined> => {
      const { id, typeName, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);
      const chainPair = await helpers.stateAdapter.getChain({
        txCtx,
        chainId: id,
      });

      if (!chainPair) return undefined;

      if (typeName && chainPair[0].chainTypeName !== typeName) {
        throw new JobTypeMismatchError(
          `Expected chain ${String(id)} to have type "${typeName}" but found "${chainPair[0].chainTypeName}"`,
          { expectedTypeName: typeName, actualTypeName: chainPair[0].chainTypeName },
        );
      }

      return mapStatePairToChain(chainPair) as ResolvedChain<
        TJobId,
        TJobTypeDefinitions,
        TChainTypeName
      >;
    },

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
      const job = await helpers.stateAdapter.getJob({ txCtx, jobId: id });

      if (!job) return undefined;

      if (typeName && job.typeName !== typeName) {
        throw new JobTypeMismatchError(
          `Expected job ${String(id)} to have type "${typeName}" but found "${job.typeName}"`,
          { expectedTypeName: typeName, actualTypeName: job.typeName },
        );
      }

      return mapStateJobToJob(job) as ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>;
    },

    listChains: async <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
      options: {
        filter?: {
          typeName?: TChainTypeName[];
          status?: JobStatus[];
          chainId?: TJobId[];
          jobId?: TJobId[];
          root?: boolean;
          from?: Date;
          to?: Date;
        };
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName>>> => {
      const { filter, orderDirection = "desc", cursor, limit = 50, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);
      const result = await helpers.stateAdapter.listChains({
        txCtx,
        filter: {
          typeName: filter?.typeName,
          status: filter?.status,
          rootOnly: filter?.root,
          chainId: filter?.chainId,
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
            mapStatePairToChain(pair) as ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName>,
        ),
        nextCursor: result.nextCursor,
      };
    },

    listJobs: async <TJobTypeName extends JobTypeNames<TJobTypeDefinitions>>(
      options: {
        filter?: {
          typeName?: TJobTypeName[];
          status?: JobStatus[];
          jobId?: TJobId[];
          chainTypeName?: JobTypeEntryNames<TJobTypeDefinitions>[];
          chainId?: TJobId[];
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
          chainTypeName: filter?.chainTypeName,
          jobId: filter?.jobId,
          chainId: filter?.chainId,
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

    listChainJobs: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        chainId: TJobId;
        typeName?: TChainTypeName;
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<ResolvedChainJobs<TJobId, TJobTypeDefinitions, TChainTypeName>>> => {
      const { chainId, typeName, orderDirection = "asc", cursor, limit = 50, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);

      if (typeName) {
        const chainPair = await helpers.stateAdapter.getChain({ txCtx, chainId });
        if (chainPair && chainPair[0].chainTypeName !== typeName) {
          throw new JobTypeMismatchError(
            `Expected chain ${String(chainId)} to have type "${typeName}" but found "${chainPair[0].chainTypeName}"`,
            { expectedTypeName: typeName, actualTypeName: chainPair[0].chainTypeName },
          );
        }
      }

      const result = await helpers.stateAdapter.listChainJobs({
        txCtx,
        chainId,
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
        const job = await helpers.stateAdapter.getJob({ txCtx, jobId });
        if (job && job.typeName !== typeName) {
          throw new JobTypeMismatchError(
            `Expected job ${String(jobId)} to have type "${typeName}" but found "${job.typeName}"`,
            { expectedTypeName: typeName, actualTypeName: job.typeName },
          );
        }
      }

      const blockers = await helpers.stateAdapter.getJobBlockers({ txCtx, jobId });
      return blockers.map((pair) => mapStatePairToChain(pair)) as unknown as TBlockers;
    },

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
        chainId: TJobId;
        typeName?: TChainTypeName;
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<TBlockedJob>> => {
      const { chainId, typeName, orderDirection = "desc", cursor, limit = 50, ...rest } = options;
      const txCtx = normalizeTxCtx(rest);

      if (typeName) {
        const chainPair = await helpers.stateAdapter.getChain({ txCtx, chainId });
        if (chainPair && chainPair[0].chainTypeName !== typeName) {
          throw new JobTypeMismatchError(
            `Expected chain ${String(chainId)} to have type "${typeName}" but found "${chainPair[0].chainTypeName}"`,
            { expectedTypeName: typeName, actualTypeName: chainPair[0].chainTypeName },
          );
        }
      }

      const result = await helpers.stateAdapter.listBlockedJobs({
        txCtx,
        chainId,
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
