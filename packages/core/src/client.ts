import { type AnyChain, type Chain, mapStatePairToChain } from "./entities/chain.js";
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
import { type AnyJob, deriveStatus, mapStateJobToJob } from "./entities/job.js";
import {
  type JobTypesDefinitions,
  type ValidatedSlices,
  mergeJobTypes,
} from "./entities/merge-job-types.js";
import { type ScheduleOptions } from "./entities/schedule.js";
import {
  BlockerReferenceError,
  ChainNotFoundError,
  ChainTypeMismatchError,
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobNotReschedulableError,
  JobTypeMismatchError,
  JobsNotFoundError,
  JobsNotReschedulableError,
  TransactionContextRequiredError,
  WaitChainTimeoutError,
} from "./errors.js";
import { bufferNotifyJobAttemptLost, bufferNotifyJobScheduled } from "./helpers/notify-hooks.js";
import { bufferObservabilityEvent } from "./helpers/observability-hooks.js";
import { raceWithSleep } from "./helpers/sleep.js";
import { type IsUnion } from "./helpers/typescript.js";
import { continueWith } from "./implementation/continue-with.js";
import { createChains } from "./implementation/create-chains.js";
import { finishJob } from "./implementation/finish-job.js";
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
} from "./state-adapter/state-adapter.js";
import { type TransactionHooks } from "./transaction-hooks.js";
import { type AttemptCompleteOptions } from "./worker/job-process.js";

/**
 * @internal Used by `createInProcessWorker` and `createDashboard` to access
 * client internals. Not part of the public API.
 */
export const helpersSymbol: unique symbol = Symbol("queuert.helpers");

const normalizeTxCtx = <T extends Record<string, unknown>>(rest: T): T | undefined =>
  Object.keys(rest).length > 0 ? rest : undefined;

const requireTxCtx = <T extends Record<string, unknown>>(rest: T): T => {
  if (Object.keys(rest).length === 0) {
    throw new TransactionContextRequiredError(
      "This client method requires a transaction context from withTransaction",
    );
  }
  return rest;
};

/**
 * Transaction-context typing for the lockable read methods. `lock: true`
 * acquires a write-intent lock on the matched rows for the enclosing
 * transaction, so it requires a transaction context; without `lock` the context
 * stays optional. Modelled as a discriminated union so `{ lock: true }` without
 * a transaction context fails to compile.
 */
type LockableReadTxContext<TStateAdapter extends StateAdapter<any, any>> =
  | ({ lock?: false } & Partial<GetStateAdapterTxContext<TStateAdapter>>)
  | ({ lock: true } & GetStateAdapterTxContext<TStateAdapter>);

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
  : TCompleteReturn extends AnyJob & { status: "pending" }
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

type CreateChainEntry<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
> = {
  typeName: TTypeName;
  id?: TJobId;
  input: JobTypeProperty<TJobTypeDefinitions, TTypeName, "input">;
  deduplication?: DeduplicationOptions<TJobId>;
  schedule?: ScheduleOptions;
} & (JobTypeHasBlockers<TJobTypeDefinitions, TTypeName> extends true
  ? { blockers: BlockerChains<TJobId, TJobTypeDefinitions, TTypeName> }
  : { blockers?: never });

type AnyCreateChainEntry<TJobId, TJobTypeDefinitions extends BaseJobTypeDefinitions> = {
  [TN in JobTypeEntryNames<TJobTypeDefinitions>]: CreateChainEntry<TJobId, TJobTypeDefinitions, TN>;
}[JobTypeEntryNames<TJobTypeDefinitions>];

type CreateChainsResult<
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
 * - **Mutating** — `createChain`, `createChains`, `completeChain`, `deleteChain`, `deleteChains`, `rescheduleJob`, `rescheduleJobs`. Require `transactionHooks` and a transaction context.
 * - **Read-only** — `getChain`, `getJob`, `listChains`, `listJobs`, `listChainJobs`, `getJobBlockers`, `listBlockedJobs`, `awaitChain`. Accept an optional transaction context.
 */
export type Client<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
  TJobId = GetStateAdapterJobId<TStateAdapter>,
> = {
  readonly [helpersSymbol]: Helpers;

  /**
   * Create a new chain. Returns the created chain with a `deduplicated` flag.
   * Pass `id` to assign a caller-supplied ID for the root job; if the chain is
   * deduplicated, the returned chain carries the existing row's ID, not the
   * caller's.
   *
   * @throws {@link InvalidJobIdError} if `id` fails the state adapter's `validateId` check.
   * @throws {@link BlockerLimitExceededError} if the root job declares more blockers than the per-job limit.
   * @throws {@link TransactionContextRequiredError} if called without a transaction context.
   */
  createChain: <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
    options: CreateChainEntry<TJobId, TJobTypeDefinitions, TChainTypeName> & {
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<
    ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
      deduplicated: boolean;
    }
  >;

  /**
   * Create multiple chains in a single batch operation. Returns created chains
   * with `deduplicated` flags, in the same order as input. Each item may carry
   * an optional `id`; dedup wins over a caller-supplied id when applicable.
   *
   * @throws {@link InvalidJobIdError} if any `id` fails the state adapter's `validateId` check.
   * @throws {@link BlockerLimitExceededError} if any root job declares more blockers than the per-job limit.
   * @throws {@link TransactionContextRequiredError} if called without a transaction context.
   */
  createChains: <const TChains extends readonly AnyCreateChainEntry<TJobId, TJobTypeDefinitions>[]>(
    options: {
      items: TChains;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<CreateChainsResult<TJobId, TJobTypeDefinitions, TChains>>;

  /**
   * Delete a single chain by ID. Returns the deleted chain, or `undefined` if no
   * chain with that ID exists. When `cascade` is true, includes transitive
   * dependencies.
   *
   * @throws {@link BlockerReferenceError} if external jobs depend on it.
   * @throws {@link TransactionContextRequiredError} if called without a transaction context.
   */
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

  /**
   * Delete chains by ID. Missing IDs are silently skipped. When `cascade` is
   * true, includes transitive dependencies.
   *
   * @throws {@link BlockerReferenceError} if external jobs depend on them.
   * @throws {@link TransactionContextRequiredError} if called without a transaction context.
   */
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

  /**
   * Reschedule a pending job by setting its `scheduledAt` from the optional
   * `schedule` (`{ at }` | `{ afterMs }`); omitting `schedule` reschedules to
   * now. Past times clamp to now.
   *
   * @throws {@link JobNotFoundError} if the job does not exist.
   * @throws {@link JobNotReschedulableError} if the job is not pending.
   * @throws {@link TransactionContextRequiredError} if called without a transaction context.
   */
  rescheduleJob: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      id: TJobId;
      schedule?: ScheduleOptions;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>>;

  /**
   * Reschedule multiple pending jobs, setting each `scheduledAt` from the
   * optional `schedule` (omitted = now, past times clamped to now). Validation
   * is atomic — no job is rescheduled on failure. Returns jobs in input order.
   * Empty `ids` returns `[]`.
   *
   * @throws {@link JobsNotFoundError} (batch variant listing every offending id) if any input is missing.
   * @throws {@link JobsNotReschedulableError} (batch variant listing every offending id) if any input is not pending.
   * @throws {@link TransactionContextRequiredError} if called without a transaction context.
   */
  rescheduleJobs: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      ids: TJobId[];
      schedule?: ScheduleOptions;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>[]>;

  /**
   * Complete a chain from outside a worker. Validates `typeName`, then passes
   * the current job and a `complete` function to the caller.
   *
   * @throws {@link ChainNotFoundError} if the chain does not exist.
   * @throws {@link ChainTypeMismatchError} if the chain's type does not match `typeName`.
   * @throws {@link TransactionContextRequiredError} if called without a transaction context.
   * @throws {@link JobAlreadyCompletedError} from the inner `complete` callback if the job is already completed.
   * @throws {@link BlockerLimitExceededError} from the inner `complete` callback if a `continueWith` declares more blockers than the per-job limit.
   */
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

  /**
   * Wait for a chain to complete. Combines polling with notify adapter events.
   *
   * @throws {@link WaitChainTimeoutError} on timeout or abort.
   * @throws {@link ChainNotFoundError} if the chain disappears or never existed.
   * @throws {@link ChainTypeMismatchError} if `typeName` is provided and does not match.
   */
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
    ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
      status: "completed";
    }
  >;

  /**
   * Get a single chain by ID. Pass `typeName` for type narrowing. Pass
   * `lock: true` (transaction context required) to hold a write-intent lock on
   * the matched row until the enclosing transaction ends, for a race-free
   * read-modify-write. A lookup that matches nothing locks nothing.
   *
   * @throws {@link ChainTypeMismatchError} if `typeName` is provided and does not match.
   * @throws {@link TransactionContextRequiredError} if `lock: true` is passed without a transaction context.
   */
  getChain: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TChainTypeName;
      id: TJobId;
    } & LockableReadTxContext<TStateAdapter>,
  ) => Promise<ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined>;

  /**
   * Get multiple chains by ID. Returns a positional array aligned with the
   * input `ids` — `undefined` for any ID that does not exist. Pass `typeName`
   * to narrow the return type; all found chains must match or
   * {@link ChainTypeMismatchError} is thrown. Pass `lock: true` (transaction
   * context required) to hold a write-intent lock on every matched row until the
   * enclosing transaction ends. Rows that do not exist lock nothing.
   *
   * @throws {@link ChainTypeMismatchError} if `typeName` is provided and any found chain does not match.
   * @throws {@link TransactionContextRequiredError} if `lock: true` is passed without a transaction context.
   */
  getChains: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TChainTypeName;
      ids: TJobId[];
    } & LockableReadTxContext<TStateAdapter>,
  ) => Promise<(ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined)[]>;

  /**
   * Get a single job by ID. Pass `typeName` for type narrowing. Pass
   * `lock: true` (transaction context required) to hold a write-intent lock on
   * the matched row until the enclosing transaction ends, for a race-free
   * read-modify-write. A lookup that matches nothing locks nothing.
   *
   * @throws {@link JobTypeMismatchError} if `typeName` is provided and does not match.
   * @throws {@link TransactionContextRequiredError} if `lock: true` is passed without a transaction context.
   */
  getJob: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TJobTypeName;
      id: TJobId;
    } & LockableReadTxContext<TStateAdapter>,
  ) => Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName> | undefined>;

  /**
   * Get multiple jobs by ID. Returns a positional array aligned with the
   * input `ids` — `undefined` for any ID that does not exist. Pass `typeName`
   * to narrow the return type; all found jobs must match or
   * {@link JobTypeMismatchError} is thrown. Pass `lock: true` (transaction
   * context required) to hold a write-intent lock on every matched row until the
   * enclosing transaction ends. Rows that do not exist lock nothing.
   *
   * @throws {@link JobTypeMismatchError} if `typeName` is provided and any found job does not match.
   * @throws {@link TransactionContextRequiredError} if `lock: true` is passed without a transaction context.
   */
  getJobs: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TJobTypeName;
      ids: TJobId[];
    } & LockableReadTxContext<TStateAdapter>,
  ) => Promise<(ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName> | undefined)[]>;

  /**
   * List chains with filtering and cursor-based pagination. Defaults to newest first.
   *
   * @remarks
   * Filtering by `status` alone is not optimized — it applies to the last job in the chain
   * and cannot use an index. Always combine with `typeName` or a date range (`from`/`to`).
   */
  listChains: <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
    options: {
      typeName?: TChainTypeName[];
      independent?: boolean;
      chainId?: TJobId[];
      from?: Date;
      to?: Date;
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & (
      | { status?: undefined; orderBy?: "createdAt" }
      | { status: "running"; orderBy?: "createdAt" }
      | { status: "completed"; orderBy?: "createdAt" | "completedAt" }
    ) &
      Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<Page<ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName>>>;

  /**
   * List jobs with filtering and cursor-based pagination. Defaults to newest
   * first. Blockers are not populated — use
   * {@link Client.getJobBlockers | getJobBlockers} for a specific job.
   */
  listJobs: <TJobTypeName extends JobTypeNames<TJobTypeDefinitions>>(
    options: {
      typeName?: TJobTypeName[];
      chainTypeName?: JobTypeEntryNames<TJobTypeDefinitions>[];
      chainId?: TJobId[];
      jobId?: TJobId[];
      from?: Date;
      to?: Date;
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & (
      | { status?: undefined; orderBy?: "createdAt" }
      | { status: "pending"; blocked?: boolean; orderBy?: "createdAt" | "scheduledAt" }
      | { status: "running"; orderBy?: "createdAt" | "attemptAt" | "attemptUntil" }
      | { status: "completed"; continued?: boolean; orderBy?: "createdAt" | "completedAt" }
    ) &
      Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<Page<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>>>;

  /**
   * List jobs within a specific chain, in chain order. Defaults to ascending
   * order. Pass `chainTypeName` for type narrowing.
   *
   * @throws {@link ChainTypeMismatchError} if `chainTypeName` is provided and does not match.
   */
  listChainJobs: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      chainId: TJobId;
      chainTypeName?: TChainTypeName;
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<Page<ResolvedChainJobs<TJobId, TJobTypeDefinitions, TChainTypeName>>>;

  /**
   * Get the blocker chains for a specific job. Not paginated — blockers are
   * bounded by design. Pass `typeName` for type narrowing.
   *
   * @throws {@link JobTypeMismatchError} if `typeName` is provided and does not match.
   */
  getJobBlockers: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    TBlockers extends readonly unknown[] = BlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName>,
  >(
    options: {
      jobId: TJobId;
      typeName?: TJobTypeName;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<TBlockers>;

  /**
   * List jobs from other chains that are blocked by a given chain. Useful for
   * understanding downstream impact before deletion. Pass `typeName` for type
   * narrowing.
   *
   * @throws {@link ChainTypeMismatchError} if `typeName` is provided and does not match.
   */
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
 * @param options - Client configuration.
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
  /** Database adapter for job persistence. */
  stateAdapter: TStateAdapter;
  /** Optional pub/sub adapter for real-time notifications. */
  notifyAdapter?: NotifyAdapter;
  /** Optional adapter for metrics and tracing. */
  observabilityAdapter?: ObservabilityAdapter;
  /**
   * A single JobTypes slice, or an array of slices to merge. Slices are built
   * with {@link defineJobTypes} or {@link createJobTypes}.
   */
  jobTypes: TJobTypes extends readonly JobTypes<any>[]
    ? ValidatedSlices<TJobTypes> & TJobTypes
    : TJobTypes;
  /** Optional structured log function. */
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

    createChain: async <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
      options: {
        typeName: TChainTypeName;
        id?: TJobId;
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
      const { input, id, typeName, deduplication, schedule, blockers, transactionHooks, ...rest } =
        options;
      const txCtx = requireTxCtx(rest);
      const [result] = await createChains(helpers, {
        chains: [{ typeName, id, input, deduplication, schedule, blockers }],
        txCtx,
        transactionHooks,
      });
      return result as ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
        deduplicated: boolean;
      };
    },

    createChains: async <
      const TChains extends readonly AnyCreateChainEntry<TJobId, TJobTypeDefinitions>[],
    >(
      options: {
        items: TChains;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<CreateChainsResult<TJobId, TJobTypeDefinitions, TChains>> => {
      const { items, transactionHooks, ...rest } = options;
      const txCtx = requireTxCtx(rest);
      return (await createChains(helpers, {
        chains: items,
        txCtx,
        transactionHooks,
      })) as CreateChainsResult<TJobId, TJobTypeDefinitions, TChains>;
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

    rescheduleJob: async <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: {
        id: TJobId;
        schedule?: ScheduleOptions;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>> => {
      const { id, schedule, transactionHooks, ...rest } = options;
      try {
        const [job] = await client.rescheduleJobs<TJobTypeName>({
          ids: [id],
          schedule,
          transactionHooks,
          ...(rest as GetStateAdapterTxContext<TStateAdapter>),
        });
        return job;
      } catch (error) {
        if (error instanceof JobsNotFoundError) {
          throw new JobNotFoundError(`Job with id ${String(id)} not found`, {
            jobId: id as string,
            cause: error,
          });
        }
        if (error instanceof JobsNotReschedulableError) {
          throw new JobNotReschedulableError(
            `Cannot reschedule job ${String(id)}: job is not "pending"`,
            { jobId: id as string, cause: error },
          );
        }
        throw error;
      }
    },

    rescheduleJobs: async <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: {
        ids: TJobId[];
        schedule?: ScheduleOptions;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>[]> => {
      const { ids, schedule, transactionHooks, ...rest } = options;
      const txCtx = requireTxCtx(rest);

      if (ids.length === 0) return [];
      const classified = await helpers.stateAdapter.getJobs({
        txCtx,
        jobIds: ids,
        lock: "exclusive",
      });

      const notFound: TJobId[] = [];
      const notReschedulable: { jobId: TJobId; status: string }[] = [];
      classified.forEach((entry, index) => {
        if (entry === undefined) {
          notFound.push(ids[index]);
        } else if (entry.completedAt !== null || entry.attemptAt !== null) {
          notReschedulable.push({
            jobId: entry.id as TJobId,
            status: deriveStatus(entry),
          });
        }
      });
      if (notFound.length > 0) {
        throw new JobsNotFoundError(`Jobs not found: ${notFound.join(", ")}`, {
          jobIds: notFound,
        });
      }
      if (notReschedulable.length > 0) {
        throw new JobsNotReschedulableError(
          `Cannot reschedule jobs whose status is not "pending": ${notReschedulable
            .map((j) => `${j.jobId} (${j.status})`)
            .join(", ")}`,
          { jobIds: notReschedulable.map((j) => j.jobId) },
        );
      }

      const rescheduled = await helpers.stateAdapter.rescheduleJobs({
        txCtx,
        jobIds: ids,
        schedule,
      });
      for (const job of rescheduled) {
        bufferNotifyJobScheduled(transactionHooks, helpers.notifyAdapter, job);
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.jobRescheduled(job);
        });
      }
      return rescheduled.map(
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
      const classified = await helpers.stateAdapter.getChains({
        txCtx,
        chainIds: [id],
        lock: "exclusive",
      });

      const chainPair = classified[0];
      if (chainPair === undefined) {
        throw new ChainNotFoundError(`Chain with id ${id} not found`, {
          chainId: id,
        });
      }

      const [headJob, tailJob] = chainPair;
      const currentJob = tailJob ?? headJob;

      if (currentJob.chainTypeName !== typeName) {
        throw new ChainTypeMismatchError(
          `Expected chain ${String(id)} to have type "${typeName}" but found "${currentJob.chainTypeName}"`,
          {
            expectedTypeName: typeName,
            actualTypeName: currentJob.chainTypeName,
          },
        );
      }

      const complete = async (
        job: AnyJob,
        jobCompleteCallback: (
          options: {
            continueWith: (options: {
              typeName: string;
              id?: TJobId;
              input: unknown;
              schedule?: ScheduleOptions;
              blockers?: AnyChain[];
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

        const [stateJob] = await helpers.stateAdapter.getJobs({
          txCtx,
          jobIds: [job.id],
          lock: "exclusive",
        });
        if (!stateJob) {
          throw new JobNotFoundError(`Job ${job.id} not found`, { jobId: job.id });
        }

        let continuedJob: AnyJob | null = null;

        const output = await jobCompleteCallback({
          transactionHooks,
          continueWith: async ({ typeName, id, input, schedule, blockers }) => {
            if (continuedJob) {
              throw new Error("continueWith can only be called once");
            }

            continuedJob = await continueWith(helpers, {
              typeName,
              id,
              input,
              txCtx,
              transactionHooks,
              schedule,
              blockers: blockers as any,
              fromJob: stateJob,
            });

            return continuedJob;
          },
          ...txCtx,
        });

        const wasRunning = job.status === "running";

        await finishJob(helpers, {
          job: stateJob,
          txCtx,
          transactionHooks,
          workerId: null,
          output,
          continuedJob,
        });

        if (wasRunning) {
          bufferNotifyJobAttemptLost(transactionHooks, helpers.notifyAdapter, job.id);
        }

        return continuedJob ?? output;
      };

      await completeCallback({ job: mapStateJobToJob(currentJob) as any, complete });

      const [updatedChain] = await helpers.stateAdapter.getChains({
        txCtx,
        chainIds: [id],
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
      ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
        status: "completed";
      }
    > => {
      const { id, typeName } = chain;
      const { timeoutMs, pollIntervalMs = 15_000, signal } = options;

      let typeValidated = !typeName;

      const checkChain = async () => {
        const [chainPair] = await helpers.stateAdapter.getChains({
          chainIds: [id],
        });
        if (!chainPair) {
          throw new ChainNotFoundError(`Chain with id ${id} not found`, {
            chainId: id as string,
          });
        }

        if (!typeValidated) {
          if (chainPair[0].chainTypeName !== typeName) {
            throw new ChainTypeMismatchError(
              `Expected chain ${String(id)} to have type "${typeName}" but found "${chainPair[0].chainTypeName}"`,
              {
                expectedTypeName: typeName!,
                actualTypeName: chainPair[0].chainTypeName,
              },
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
          await raceWithSleep(notificationPromise, pollIntervalMs, {
            signal: combinedSignal,
          });
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
        lock?: boolean;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined> => {
      const { id, typeName, ...rest } = options;
      const [chain] = await client.getChains<TChainTypeName>({
        typeName,
        ids: [id],
        ...(rest as LockableReadTxContext<TStateAdapter>),
      });
      return chain;
    },

    getChains: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName?: TChainTypeName;
        ids: TJobId[];
        lock?: boolean;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<(ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined)[]> => {
      const { ids, typeName, lock, ...rest } = options;

      if (ids.length === 0) return [];

      const chainPairs = lock
        ? await helpers.stateAdapter.getChains({
            txCtx: requireTxCtx(rest),
            chainIds: ids,
            lock: "exclusive",
          })
        : await helpers.stateAdapter.getChains({ txCtx: normalizeTxCtx(rest), chainIds: ids });

      if (typeName) {
        const mismatch = chainPairs.find((p) => p && p[0].chainTypeName !== typeName);
        if (mismatch) {
          const idx = chainPairs.indexOf(mismatch);
          throw new ChainTypeMismatchError(
            `Expected chain ${String(ids[idx])} to have type "${typeName}" but found "${mismatch[0].chainTypeName}"`,
            {
              expectedTypeName: typeName,
              actualTypeName: mismatch[0].chainTypeName,
            },
          );
        }
      }

      return chainPairs.map((chainPair) => {
        if (!chainPair) return undefined;

        return mapStatePairToChain(chainPair) as ResolvedChain<
          TJobId,
          TJobTypeDefinitions,
          TChainTypeName
        >;
      });
    },

    getJob: async <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName?: TJobTypeName;
        id: TJobId;
        lock?: boolean;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName> | undefined> => {
      const { id, typeName, ...rest } = options;
      const [job] = await client.getJobs<TJobTypeName>({
        typeName,
        ids: [id],
        ...(rest as LockableReadTxContext<TStateAdapter>),
      });
      return job;
    },

    getJobs: async <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName?: TJobTypeName;
        ids: TJobId[];
        lock?: boolean;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<(ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName> | undefined)[]> => {
      const { ids, typeName, lock, ...rest } = options;

      if (ids.length === 0) return [];

      const jobs = lock
        ? await helpers.stateAdapter.getJobs({
            txCtx: requireTxCtx(rest),
            jobIds: ids,
            lock: "exclusive",
          })
        : await helpers.stateAdapter.getJobs({ txCtx: normalizeTxCtx(rest), jobIds: ids });

      if (typeName) {
        const mismatch = jobs.find((j) => j && j.typeName !== typeName);
        if (mismatch) {
          const idx = jobs.indexOf(mismatch);
          throw new JobTypeMismatchError(
            `Expected job ${String(ids[idx])} to have type "${typeName}" but found "${mismatch.typeName}"`,
            { expectedTypeName: typeName, actualTypeName: mismatch.typeName },
          );
        }
      }

      return jobs.map((job) => {
        if (!job) return undefined;

        return mapStateJobToJob(job) as ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>;
      });
    },

    listChains: async <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
      options: {
        typeName?: TChainTypeName[];
        independent?: boolean;
        chainId?: TJobId[];
        from?: Date;
        to?: Date;
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & (
        | { status?: undefined; orderBy?: "createdAt" }
        | { status: "running"; orderBy?: "createdAt" }
        | { status: "completed"; orderBy?: "createdAt" | "completedAt" }
      ) &
        Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName>>> => {
      const {
        typeName,
        independent,
        chainId,
        from,
        to,
        status,
        orderBy,
        orderDirection = "desc",
        cursor,
        limit = 50,
        ...rest
      } = options as typeof options & { status?: string; orderBy?: string };
      const txCtx = normalizeTxCtx(rest);

      const result = await helpers.stateAdapter.listChains({
        txCtx,
        typeName,
        independent,
        chainId,
        from,
        to,
        status,
        orderBy: orderBy ?? (status === "completed" ? "completedAt" : "createdAt"),
        orderDirection,
        page: { cursor, limit },
      } as Parameters<typeof helpers.stateAdapter.listChains>[0]);
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
        typeName?: TJobTypeName[];
        chainTypeName?: JobTypeEntryNames<TJobTypeDefinitions>[];
        chainId?: TJobId[];
        jobId?: TJobId[];
        from?: Date;
        to?: Date;
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & (
        | { status?: undefined; orderBy?: "createdAt" }
        | { status: "pending"; blocked?: boolean; orderBy?: "createdAt" | "scheduledAt" }
        | { status: "running"; orderBy?: "createdAt" | "attemptAt" | "attemptUntil" }
        | { status: "completed"; continued?: boolean; orderBy?: "createdAt" | "completedAt" }
      ) &
        Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>>> => {
      const {
        typeName,
        chainTypeName,
        chainId,
        jobId,
        from,
        to,
        status,
        orderBy,
        blocked,
        continued,
        orderDirection = "desc",
        cursor,
        limit = 50,
        ...rest
      } = options as typeof options & {
        status?: string;
        orderBy?: string;
        blocked?: boolean;
        continued?: boolean;
      };
      const txCtx = normalizeTxCtx(rest);

      const defaultOrderBy: Record<string, string> = {
        pending: "scheduledAt",
        running: "attemptAt",
        completed: "completedAt",
      };
      const resolvedOrderBy = orderBy ?? (status ? defaultOrderBy[status] : "createdAt");

      const result = await helpers.stateAdapter.listJobs({
        txCtx,
        typeName,
        chainTypeName,
        chainId,
        jobId,
        from,
        to,
        status,
        orderBy: resolvedOrderBy,
        orderDirection,
        page: { cursor, limit },
        ...(blocked !== undefined ? { blocked } : {}),
        ...(continued !== undefined ? { continued } : {}),
      } as Parameters<typeof helpers.stateAdapter.listJobs>[0]);
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
        chainTypeName?: TChainTypeName;
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<ResolvedChainJobs<TJobId, TJobTypeDefinitions, TChainTypeName>>> => {
      const {
        chainId,
        chainTypeName,
        orderDirection = "asc",
        cursor,
        limit = 50,
        ...rest
      } = options;
      const txCtx = normalizeTxCtx(rest);

      if (chainTypeName) {
        const [chainPair] = await helpers.stateAdapter.getChains({
          txCtx,
          chainIds: [chainId],
        });
        if (chainPair && chainPair[0].chainTypeName !== chainTypeName) {
          throw new ChainTypeMismatchError(
            `Expected chain ${String(chainId)} to have type "${chainTypeName}" but found "${chainPair[0].chainTypeName}"`,
            {
              expectedTypeName: chainTypeName,
              actualTypeName: chainPair[0].chainTypeName,
            },
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
        const [job] = await helpers.stateAdapter.getJobs({
          txCtx,
          jobIds: [jobId],
        });
        if (job && job.typeName !== typeName) {
          throw new JobTypeMismatchError(
            `Expected job ${String(jobId)} to have type "${typeName}" but found "${job.typeName}"`,
            { expectedTypeName: typeName, actualTypeName: job.typeName },
          );
        }
      }

      const blockers = await helpers.stateAdapter.getJobBlockers({
        txCtx,
        jobId,
      });
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
        const [chainPair] = await helpers.stateAdapter.getChains({
          txCtx,
          chainIds: [chainId],
        });
        if (chainPair && chainPair[0].chainTypeName !== typeName) {
          throw new ChainTypeMismatchError(
            `Expected chain ${String(chainId)} to have type "${typeName}" but found "${chainPair[0].chainTypeName}"`,
            {
              expectedTypeName: typeName,
              actualTypeName: chainPair[0].chainTypeName,
            },
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
