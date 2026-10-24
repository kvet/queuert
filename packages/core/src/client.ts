import { raceWithSleep, setLongTimeout, createCallOnce, type IsUnion } from "@queuert/helpers";

import {
  type AttemptCompleteResult,
  type AttemptOutcome,
} from "./attempt/attempt-handler.types.js";
import {
  type ChainFields,
  type CompletedChainFields,
  mapStateChainToChain,
} from "./entities/chain.js";
import {
  type AnyJob,
  type CompletedJob,
  type JobStatus,
  mapStateJobToJob,
} from "./entities/job.js";
import { type OrderDirection, type Page } from "./entities/pagination.js";
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
  WaitChainTimeoutError,
} from "./errors.js";
import { completeChain, continueChain, createChains, rescheduleJobs } from "./implementation.js";
import { type BaseJobTypeDefinitions } from "./job-types/job-type.js";
import { type JobTypes } from "./job-types/job-types.js";
import {
  type BlockerChains,
  type JobTypeBlockedNames,
  type JobTypeChainNames,
  type JobTypeEntryNames,
  type JobTypeNames,
  type JobTypeProperty,
  type NewChain,
  type AnyNewJob,
  type ResolvedChain,
  type ResolvedChainJobs,
  type ResolvedJob,
  type ResolvedRunningChain,
} from "./job-types/job-types.resolvers.js";
import {
  type JobTypesDefinitions,
  type ValidatedSlices,
  mergeJobTypes,
} from "./job-types/merge-job-types.js";
import { type NotifyAdapter } from "./notify-adapter/notify-adapter.js";
import { bufferNotifyJobAttemptLost } from "./notify-adapter/notify-hooks.js";
import { type Log } from "./observability-adapter/log.js";
import { type ObservabilityAdapter } from "./observability-adapter/observability-adapter.js";
import { bufferObservabilityEvent } from "./observability-adapter/observability-hooks.js";
import { type Helpers, createHelpers } from "./setup-helpers.js";
import {
  type BaseTxContext,
  type GetStateAdapterJobId,
  type GetStateAdapterTxContext,
  type StateAdapter,
  type StateChain,
  type StateJob,
  type StateJobInfo,
} from "./state-adapter/state-adapter.js";
import { normalizeTxCtx, requireTxCtx } from "./state-adapter/tx-context.js";
import { type TransactionHooks, requireTransactionHooks } from "./transaction-hooks.js";

/**
 * @internal Used by `createInProcessWorker` and `createDashboard` to access
 * client internals. Not part of the public API.
 */
export const helpersSymbol: unique symbol = Symbol("queuert.helpers");

type AnyWorkerlessOutcome = { output: unknown } | { continueWith: AnyNewJob };

type ChainCompleteOptions<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
> = {
  complete: <TOutcome extends AttemptOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>>(
    outcome: TOutcome,
  ) => Promise<
    AttemptCompleteResult<
      TStateAdapter,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName,
      TOutcome
    >
  >;
  transactionHooks: TransactionHooks;
} & GetStateAdapterTxContext<TStateAdapter>;

type ChainCompleteJobResult<TResult> = TResult extends { continuedTo: undefined }
  ? TResult
  : TResult extends { continuedTo: infer TContinuation }
    ? TContinuation
    : TResult;

type ChainHandler<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
> = (options: {
  job: ResolvedChainJobs<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TChainTypeName>;
  completeJob: <
    TJobTypeName extends JobTypeChainNames<TJobTypeDefinitions, TChainTypeName> & string,
    TResult extends CompletedJob<AnyJob>,
  >(
    ...args: true extends IsUnion<TJobTypeName>
      ? [job: "Error: narrow the job type before calling completeJob (e.g. check job.typeName)"]
      : [
          job: ResolvedJob<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TJobTypeName,
            TChainTypeName
          >,
          completeCallback: (
            completeOptions: ChainCompleteOptions<
              TStateAdapter,
              TJobTypeDefinitions,
              TJobTypeName,
              TChainTypeName
            >,
          ) => Promise<TResult>,
        ]
  ) => Promise<ChainCompleteJobResult<TResult>>;
}) => Promise<CompletedJob<AnyJob> | void>;

type CompleteChainResult<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
  TReturn,
> = TReturn extends { continuedTo: undefined; output: infer TOutput }
  ? ChainFields<
      TJobId,
      TChainTypeName,
      JobTypeProperty<TJobTypeDefinitions, TChainTypeName, "input">
    > &
      CompletedChainFields<TOutput>
  : TReturn extends { continuedTo: AnyJob }
    ? ResolvedRunningChain<TJobId, TJobTypeDefinitions, TChainTypeName>
    : ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName>;

type CompleteChainResultFromHandler<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
  THandler,
> = THandler extends (...args: any[]) => Promise<infer TReturn>
  ? CompleteChainResult<TJobId, TJobTypeDefinitions, TChainTypeName, TReturn>
  : never;

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
 * Methods are split into three categories:
 * - **Mutating** — `createChain`, `createChains`, `completeChain`, `deleteChain`, `deleteChains`, `rescheduleJob`, `rescheduleJobs`. Require `transactionHooks` and a transaction context; they throw `Error` if called without a transaction context, or with one the state adapter's `isTransaction` reports as outside an open transaction.
 * - **Read-only** — `getChain`, `getChains`, `getJob`, `getJobs`, `listChainTypeNames`, `listJobTypeNames`, `countByChainTypeNames`, `countByJobTypeNames`, `listChains`, `listJobs`, `listChainJobs`, `getJobBlockers`, `listBlockedJobs`. Accept an optional transaction context.
 * - **Waiting** — `awaitChain`. Takes no transaction context: it polls outside any transaction and listens for notify adapter events.
 */
export type Client<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any>,
  TJobId = GetStateAdapterJobId<TStateAdapter>,
> = {
  readonly [helpersSymbol]: Helpers;

  // `awaitChain` leads on purpose: TypeScript compares members in declaration order
  // when it measures `Client`'s variance (once per program, on the first inference
  // or assignment between two `Client` instantiations), and this member settles the
  // comparison cheaply. Leading with `createChain` costs ~4k extra instantiations.

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
   * Create a new chain. Returns the created chain with a `deduplicated` flag.
   * Pass `id` to assign a caller-supplied ID for the root job; if the chain is
   * deduplicated, the returned chain carries the existing row's ID, not the
   * caller's.
   *
   * @throws {@link InvalidJobIdError} if `id` fails the state adapter's `validateId` check.
   * @throws {@link BlockerLimitExceededError} if the root job declares more blockers than the per-job limit.
   * @throws {@link ChainNotFoundError} if a blocker chain does not exist.
   * @throws {@link ChainTypeMismatchError} if a blocker's `typeName` differs from the stored chain's.
   * @throws {@link JobTypeValidationError} if the job type rejects the entry, input, or blockers.
   * @throws TypeError if `deduplication.scope` is missing or not `"running"` / `"any"`.
   * @throws The state adapter's own error (e.g. a unique-constraint violation) if a caller-supplied `id` is already taken.
   */
  createChain: <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
    options: NewChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
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
   * @throws {@link ChainNotFoundError} if any blocker chain does not exist.
   * @throws {@link ChainTypeMismatchError} if a blocker's `typeName` differs from the stored chain's.
   * @throws {@link JobTypeValidationError} if a job type rejects an item's entry, input, or blockers.
   * @throws TypeError if `deduplication.scope` is missing or not `"running"` / `"any"`.
   * @throws The state adapter's own error (e.g. a unique-constraint violation) if a caller-supplied `id` is already taken.
   */
  createChains: <const TChains extends readonly NewChain<TJobId, TJobTypeDefinitions>[]>(
    options: {
      items: TChains;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<CreateChainsResult<TJobId, TJobTypeDefinitions, TChains>>;

  /**
   * Delete a single chain by ID. Returns the deleted chain, or `undefined` if no
   * chain with that ID exists.
   *
   * @throws {@link BlockerReferenceError} if external jobs depend on it.
   */
  deleteChain: <
    TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      id: TJobId;
      transactionHooks: TransactionHooks;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<ResolvedChain<TJobId, TJobTypeDefinitions, TEntryName> | undefined>;

  /**
   * Delete chains by ID. Missing IDs are silently skipped.
   *
   * @throws {@link BlockerReferenceError} if external jobs depend on them.
   */
  deleteChains: <
    TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      ids: TJobId[];
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
   * the current job and a `completeJob` function to the `handler`. The handler
   * may decline (return without calling `completeJob`); when it does complete,
   * the callback passes exactly one outcome — `{ output }` or
   * `{ continueWith: {...} }` — to `complete`, which writes it before it returns.
   *
   * `completeJob` resolves to the continuation when the outcome continued the
   * chain, so several jobs can be walked in a row:
   *
   * ```ts
   * job = await completeJob(job, async ({ complete }) =>
   *   complete({ continueWith: { typeName: "step-a", input: { valueA: 42 } } }));
   * ```
   *
   * @throws {@link ChainNotFoundError} if the chain does not exist.
   * @throws {@link ChainTypeMismatchError} if the chain's type does not match `typeName`.
   * @throws {@link JobAlreadyCompletedError} from the inner `completeJob` if the job is already completed.
   * @throws {@link BlockerLimitExceededError} from the inner `complete` if a `continueWith` outcome declares more blockers than the per-job limit.
   * @throws {@link ChainNotFoundError} from the inner `complete` if a `continueWith` blocker chain does not exist.
   * @throws {@link ChainTypeMismatchError} from the inner `complete` if a `continueWith` blocker's `typeName` differs from the stored chain's.
   */
  completeChain: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
    // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- holds `handler` as a naked type param so a `Client` over a union of job-type definitions stays assignable to a `Client` over one member (client.covariance.spec.ts)
    THandler extends (...args: any[]) => Promise<any> = ChainHandler<
      TStateAdapter,
      TJobTypeDefinitions,
      TChainTypeName
    >,
    TResult = CompleteChainResultFromHandler<TJobId, TJobTypeDefinitions, TChainTypeName, THandler>,
  >(
    options: {
      typeName: TChainTypeName;
      id: TJobId;
      transactionHooks: TransactionHooks;
      handler: THandler;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => Promise<TResult>;

  /**
   * Get a single chain by ID. Pass `typeName` for type narrowing.
   *
   * @throws {@link ChainTypeMismatchError} if `typeName` is provided and does not match.
   */
  getChain: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TChainTypeName;
      id: TJobId;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined>;

  /**
   * Get multiple chains by ID. Returns a positional array aligned with the
   * input `ids` — `undefined` for any ID that does not exist. Pass `typeName`
   * to narrow the return type; all found chains must match or
   * {@link ChainTypeMismatchError} is thrown.
   *
   * @throws {@link ChainTypeMismatchError} if `typeName` is provided and any found chain does not match.
   */
  getChains: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TChainTypeName;
      ids: TJobId[];
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<(ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined)[]>;

  /**
   * Get a single job by ID. Pass `typeName` for type narrowing.
   *
   * @throws {@link JobTypeMismatchError} if `typeName` is provided and does not match.
   */
  getJob: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TJobTypeName;
      id: TJobId;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName> | undefined>;

  /**
   * Get multiple jobs by ID. Returns a positional array aligned with the
   * input `ids` — `undefined` for any ID that does not exist. Pass `typeName`
   * to narrow the return type; all found jobs must match or
   * {@link JobTypeMismatchError} is thrown.
   *
   * @throws {@link JobTypeMismatchError} if `typeName` is provided and any found job does not match.
   */
  getJobs: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TJobTypeName;
      ids: TJobId[];
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<(ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName> | undefined)[]>;

  /**
   * Returns distinct chain type names present in the data, sorted alphabetically.
   */
  listChainTypeNames: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options?: Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<TChainTypeName[]>;

  /**
   * Returns distinct job type names present in the data, sorted alphabetically.
   */
  listJobTypeNames: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options?: Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<TJobTypeName[]>;

  /**
   * Returns capped per-status counts for the given chain type names, in input order.
   */
  countByChainTypeNames: (
    options: {
      typeNames: JobTypeEntryNames<TJobTypeDefinitions>[];
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<
    {
      running: { count: number; hasMore: boolean };
      completed: { count: number; hasMore: boolean };
    }[]
  >;

  /**
   * Returns capped per-status counts for the given job type names, in input order.
   */
  countByJobTypeNames: (
    options: {
      typeNames: JobTypeNames<TJobTypeDefinitions>[];
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => Promise<
    {
      blocked: { count: number; hasMore: boolean };
      pending: { count: number; hasMore: boolean };
      running: { count: number; hasMore: boolean };
      completed: { count: number; hasMore: boolean };
    }[]
  >;

  /**
   * List chains with filtering and cursor-based pagination. Defaults to `orderDirection: "desc"`,
   * `limit: 50`, and `orderBy: "completedAt"` when `status` is `"completed"`, `"createdAt"` otherwise.
   */
  listChains: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName: TChainTypeName;
      independent?: boolean;
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
   * List jobs with filtering and cursor-based pagination. Defaults to `orderDirection: "desc"`,
   * `limit: 50`, and an `orderBy` that follows `status`: `scheduledAt` for blocked/pending,
   * `attemptAt` for running, `completedAt` for completed, `createdAt` when unfiltered.
   */
  listJobs: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName: TJobTypeName;
      from?: Date;
      to?: Date;
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & (
      | { status?: undefined; orderBy?: "createdAt" }
      | { status: "blocked"; orderBy?: "createdAt" | "scheduledAt" }
      | { status: "pending"; orderBy?: "createdAt" | "scheduledAt" }
      | { status: "running"; orderBy?: "createdAt" | "attemptAt" | "attemptUntil" }
      | { status: "completed"; orderBy?: "createdAt" | "completedAt" }
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

const assertChainTypeName = (
  stateChain: { typeName: string } | undefined,
  { chainId, typeName }: { chainId: string; typeName: string | undefined },
): void => {
  if (!typeName || stateChain === undefined || stateChain.typeName === typeName) return;
  throw new ChainTypeMismatchError(
    `Expected chain ${chainId} to have type "${typeName}" but found "${stateChain.typeName}"`,
    {
      expectedTypeName: typeName,
      actualTypeName: stateChain.typeName,
    },
  );
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
      options: NewChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<
      ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
        deduplicated: boolean;
      }
    > => {
      const { input, id, typeName, deduplication, schedule, blockers, transactionHooks, ...rest } =
        options;
      const txCtx = requireTxCtx(helpers.stateAdapter, rest, "createChain");
      requireTransactionHooks(transactionHooks, "createChain");
      const [result] = await createChains(helpers, {
        chains: [{ typeName, id, input, deduplication, schedule, blockers }],
        txCtx,
        transactionHooks,
      });
      return result as ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
        deduplicated: boolean;
      };
    },

    createChains: async <const TChains extends readonly NewChain<TJobId, TJobTypeDefinitions>[]>(
      options: {
        items: TChains;
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<CreateChainsResult<TJobId, TJobTypeDefinitions, TChains>> => {
      const { items, transactionHooks, ...rest } = options;
      const txCtx = requireTxCtx(helpers.stateAdapter, rest, "createChains");
      requireTransactionHooks(transactionHooks, "createChains");
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
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<ResolvedChain<TJobId, TJobTypeDefinitions, TEntryName> | undefined> => {
      const { id, transactionHooks, ...rest } = options;
      const deleted = await client.deleteChains<TEntryName>({
        ids: [id],
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
        transactionHooks: TransactionHooks;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<ResolvedChain<TJobId, TJobTypeDefinitions, TEntryName>[]> => {
      const { ids, transactionHooks, ...rest } = options;
      const txCtx = requireTxCtx(helpers.stateAdapter, rest, "deleteChains");
      requireTransactionHooks(transactionHooks, "deleteChains");

      const verdicts = await helpers.stateAdapter.deleteChains({
        txCtx,
        chainIds: ids,
      });

      const blockerRefs = verdicts.flatMap((verdict) =>
        Array.isArray(verdict)
          ? verdict.map((blockedJob) => ({
              chainId: blockedJob.blockedByChainId,
              referencedByJobId: blockedJob.jobId,
            }))
          : [],
      );
      if (blockerRefs.length > 0) {
        throw new BlockerReferenceError(
          `Cannot delete chains: ${[...new Set(blockerRefs.map((r) => r.chainId))].join(", ")} referenced as blockers`,
          { references: blockerRefs },
        );
      }

      const deletedChains = verdicts
        .filter(
          (verdict): verdict is StateChain => verdict !== undefined && !Array.isArray(verdict),
        )
        .map(
          (stateChain) =>
            mapStateChainToChain(stateChain) as ResolvedChain<
              TJobId,
              TJobTypeDefinitions,
              TEntryName
            >,
        );

      for (const stateChain of verdicts) {
        if (stateChain !== undefined && !Array.isArray(stateChain)) {
          bufferObservabilityEvent(transactionHooks, () => {
            helpers.observabilityHelper.chainDeleted(stateChain);
          });
        }
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
      const txCtx = requireTxCtx(helpers.stateAdapter, rest, "rescheduleJobs");
      requireTransactionHooks(transactionHooks, "rescheduleJobs");

      if (ids.length === 0) return [];
      const existingJobs = await helpers.stateAdapter.getJobs({
        txCtx,
        jobIds: ids,
        lock: "exclusive",
      });

      const notFound: TJobId[] = [];
      const notReschedulable: { jobId: TJobId; status: JobStatus }[] = [];
      existingJobs.forEach((stateJob, index) => {
        if (stateJob === undefined) {
          notFound.push(ids[index]);
        } else if (stateJob.status !== "pending") {
          notReschedulable.push({
            jobId: stateJob.id as TJobId,
            status: stateJob.status,
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

      const rescheduledOrMissing = await rescheduleJobs(helpers, {
        txCtx,
        transactionHooks,
        jobs: ids.map((id: TJobId) => ({ jobId: id, schedule })),
      });
      const rescheduled = rescheduledOrMissing.map((stateJob, index) => {
        if (stateJob === undefined) {
          throw new JobNotFoundError(`Job ${ids[index]} not found or already completed`, {
            jobId: ids[index],
          });
        }
        return stateJob;
      });

      return rescheduled.map(
        (stateJob) =>
          mapStateJobToJob(stateJob) as ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>,
      );
    },

    completeChain: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>,
      // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- see the `Client` declaration
      THandler extends (...args: any[]) => Promise<any> = ChainHandler<
        TStateAdapter,
        TJobTypeDefinitions,
        TChainTypeName
      >,
      TResult = CompleteChainResultFromHandler<
        TJobId,
        TJobTypeDefinitions,
        TChainTypeName,
        THandler
      >,
    >(
      options: {
        typeName: TChainTypeName;
        id: TJobId;
        transactionHooks: TransactionHooks;
        handler: THandler;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ): Promise<TResult> => {
      const { id, typeName, handler, transactionHooks, ...rest } = options;
      const txCtx = requireTxCtx(helpers.stateAdapter, rest, "completeChain");
      requireTransactionHooks(transactionHooks, "completeChain");
      const stateChains = await helpers.stateAdapter.getChains({
        txCtx,
        chainIds: [id],
        lock: "exclusive",
      });

      const stateChain = stateChains[0];
      if (stateChain === undefined) {
        throw new ChainNotFoundError(`Chain with id ${id} not found`, {
          chainId: id,
        });
      }

      assertChainTypeName(stateChain, { chainId: String(id), typeName });

      const [currentJob] = await helpers.stateAdapter.getJobs({
        txCtx,
        jobIds: [(stateChain.tail ?? stateChain.head).id],
        lock: "exclusive",
      });
      if (!currentJob) {
        throw new Error(`Current job of chain ${id} not found under the chain lock`);
      }

      const completeJob = async (
        job: AnyJob,
        completeCallback: (
          options: {
            complete: (outcome: AnyWorkerlessOutcome) => Promise<AnyJob & { continuedTo?: AnyJob }>;
            transactionHooks: TransactionHooks;
          } & BaseTxContext,
        ) => Promise<AnyJob & { continuedTo?: AnyJob }>,
      ): Promise<AnyJob & { continuedTo?: AnyJob }> => {
        if (job.status === "completed") {
          throw new JobAlreadyCompletedError(
            `Cannot complete job ${job.id}: job is already completed`,
            { jobId: job.id },
          );
        }

        const [stateJob] = await helpers.stateAdapter.getJobs({
          txCtx,
          jobIds: [job.id],
          lock: job.id === currentJob.id ? undefined : "exclusive",
        });
        if (!stateJob) {
          throw new JobNotFoundError(`Job ${job.id} not found`, { jobId: job.id });
        }
        if (stateJob.completedAt !== null) {
          throw new JobAlreadyCompletedError(
            `Cannot complete job ${job.id}: job is already completed`,
            { jobId: job.id },
          );
        }

        const wasRunning = stateJob.status === "running";
        const completeOnce = createCallOnce(
          "complete",
          async (
            outcome: AnyWorkerlessOutcome,
          ): Promise<StateJob & { continuation?: StateJobInfo }> => {
            const written =
              "output" in outcome
                ? await completeChain(helpers, {
                    job: stateJob,
                    output: outcome.output,
                    txCtx,
                    transactionHooks,
                    fence: null,
                  })
                : await continueChain(helpers, {
                    job: stateJob,
                    continueWith: outcome.continueWith,
                    txCtx,
                    transactionHooks,
                    fence: null,
                  });
            if (written === undefined) {
              throw new JobNotFoundError(`Job ${job.id} not found or already completed`, {
                jobId: job.id,
              });
            }
            return written;
          },
        );

        const callbackResult = await completeCallback({
          transactionHooks,
          complete: async (outcome) => mapStateJobToJob(await completeOnce.call(outcome)),
          ...txCtx,
        });

        const { continuation, ...finishedJob } = completeOnce.requireResult(
          "complete must be called before the completeJob callback returns",
        );
        bufferObservabilityEvent(transactionHooks, () => {
          helpers.observabilityHelper.completeJobSpan(finishedJob, {
            continuedWith: continuation,
            chainCompleted: continuation === undefined,
          });
        });
        if (wasRunning) {
          bufferNotifyJobAttemptLost(transactionHooks, helpers.notifyAdapter, job.id);
        }

        return callbackResult.continuedTo ?? callbackResult;
      };

      await handler({ job: mapStateJobToJob(currentJob), completeJob });

      const [updatedChain] = await helpers.stateAdapter.getChains({
        txCtx,
        chainIds: [id],
      });

      if (!updatedChain) {
        throw new ChainNotFoundError(`Chain with id ${id} not found after complete`, {
          chainId: id as string,
        });
      }

      return mapStateChainToChain(updatedChain) as TResult;
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

      const checkChain = async () => {
        const [stateChain] = await helpers.stateAdapter.getChains({
          chainIds: [id],
        });
        if (!stateChain) {
          throw new ChainNotFoundError(`Chain with id ${id} not found`, {
            chainId: id,
          });
        }

        assertChainTypeName(stateChain, { chainId: String(id), typeName });

        const mapped = mapStateChainToChain(stateChain);
        return mapped.status === "completed"
          ? (mapped as ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
              status: "completed";
            })
          : null;
      };

      const timeoutController = new AbortController();
      const clearTimeoutTimer = setLongTimeout(() => {
        timeoutController.abort(
          new WaitChainTimeoutError(
            `Timeout waiting for chain ${id} to complete after ${timeoutMs}ms`,
            { chainId: id, timeoutMs },
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
          { chainId: id, timeoutMs, cause: signal?.reason },
        );
      } finally {
        clearTimeoutTimer();
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
      const [chain] = await client.getChains<TChainTypeName>({
        typeName,
        ids: [id],
        ...(rest as Partial<GetStateAdapterTxContext<TStateAdapter>>),
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
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<(ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined)[]> => {
      const { ids, typeName, ...rest } = options;

      if (ids.length === 0) return [];

      const stateChains = await helpers.stateAdapter.getChains({
        txCtx: normalizeTxCtx(rest),
        chainIds: ids,
      });

      stateChains.forEach((stateChain, index) => {
        assertChainTypeName(stateChain, { chainId: String(ids[index]), typeName });
      });

      return stateChains.map((stateChain) => {
        if (!stateChain) return undefined;

        return mapStateChainToChain(stateChain) as ResolvedChain<
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
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName> | undefined> => {
      const { id, typeName, ...rest } = options;
      const [job] = await client.getJobs<TJobTypeName>({
        typeName,
        ids: [id],
        ...(rest as Partial<GetStateAdapterTxContext<TStateAdapter>>),
      });
      return job;
    },

    getJobs: async <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName?: TJobTypeName;
        ids: TJobId[];
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<(ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName> | undefined)[]> => {
      const { ids, typeName, ...rest } = options;

      if (ids.length === 0) return [];

      const stateJobs = await helpers.stateAdapter.getJobs({
        txCtx: normalizeTxCtx(rest),
        jobIds: ids,
      });

      if (typeName) {
        const mismatch = stateJobs.find((s) => s && s.typeName !== typeName);
        if (mismatch) {
          const idx = stateJobs.indexOf(mismatch);
          throw new JobTypeMismatchError(
            `Expected job ${String(ids[idx])} to have type "${typeName}" but found "${mismatch.typeName}"`,
            { expectedTypeName: typeName, actualTypeName: mismatch.typeName },
          );
        }
      }

      return stateJobs.map((stateJob) => {
        if (!stateJob) return undefined;

        return mapStateJobToJob(stateJob) as ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>;
      });
    },

    listChainTypeNames: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options?: Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<TChainTypeName[]> => {
      const txCtx = options ? normalizeTxCtx(options as Record<string, unknown>) : undefined;
      const names = await helpers.stateAdapter.listChainTypeNames({ txCtx });
      return names.sort() as TChainTypeName[];
    },

    listJobTypeNames: async <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options?: Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<TJobTypeName[]> => {
      const txCtx = options ? normalizeTxCtx(options as Record<string, unknown>) : undefined;
      const names = await helpers.stateAdapter.listJobTypeNames({ txCtx });
      return names.sort() as TJobTypeName[];
    },

    countByJobTypeNames: async ({ typeNames, ...rest }) => {
      const txCtx = normalizeTxCtx(rest as Record<string, unknown>);
      return helpers.stateAdapter.countByJobTypeNames({ txCtx, typeNames });
    },

    countByChainTypeNames: async ({ typeNames, ...rest }) => {
      const txCtx = normalizeTxCtx(rest as Record<string, unknown>);
      return helpers.stateAdapter.countByChainTypeNames({ txCtx, typeNames });
    },

    listChains: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName: TChainTypeName;
        independent?: boolean;
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
        from,
        to,
        status,
        orderBy: orderBy ?? (status === "completed" ? "completedAt" : "createdAt"),
        orderDirection,
        page: { cursor, limit },
      } as Parameters<typeof helpers.stateAdapter.listChains>[0]);
      return {
        items: result.items.map(
          (stateChain) =>
            mapStateChainToChain(stateChain) as ResolvedChain<
              TJobId,
              TJobTypeDefinitions,
              TChainTypeName
            >,
        ),
        nextCursor: result.nextCursor,
      };
    },

    listJobs: async <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName: TJobTypeName;
        from?: Date;
        to?: Date;
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & (
        | { status?: undefined; orderBy?: "createdAt" }
        | { status: "blocked"; orderBy?: "createdAt" | "scheduledAt" }
        | { status: "pending"; orderBy?: "createdAt" | "scheduledAt" }
        | { status: "running"; orderBy?: "createdAt" | "attemptAt" | "attemptUntil" }
        | { status: "completed"; orderBy?: "createdAt" | "completedAt" }
      ) &
        Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ): Promise<Page<ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>>> => {
      const {
        typeName,
        from,
        to,
        status,
        orderBy,
        orderDirection = "desc",
        cursor,
        limit = 50,
        ...rest
      } = options as typeof options & {
        status?: string;
        orderBy?: string;
      };
      const txCtx = normalizeTxCtx(rest);

      const defaultOrderBy: Record<string, string> = {
        blocked: "scheduledAt",
        pending: "scheduledAt",
        running: "attemptAt",
        completed: "completedAt",
      };
      const resolvedOrderBy = orderBy ?? (status ? defaultOrderBy[status] : "createdAt");

      const result = await helpers.stateAdapter.listJobs({
        txCtx,
        typeName,
        from,
        to,
        status,
        orderBy: resolvedOrderBy,
        orderDirection,
        page: { cursor, limit },
      } as Parameters<typeof helpers.stateAdapter.listJobs>[0]);
      return {
        items: result.items.map(
          (stateJob) =>
            mapStateJobToJob(stateJob) as ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName>,
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
        const [stateChain] = await helpers.stateAdapter.getChains({
          txCtx,
          chainIds: [chainId],
        });
        assertChainTypeName(stateChain, { chainId: String(chainId), typeName: chainTypeName });
      }

      const result = await helpers.stateAdapter.listChainJobs({
        txCtx,
        chainId,
        orderDirection,
        page: { cursor, limit },
      });
      return {
        items: result.items.map(
          (stateJob) =>
            mapStateJobToJob(stateJob) as ResolvedChainJobs<
              TJobId,
              TJobTypeDefinitions,
              TChainTypeName
            >,
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
        const [stateJob] = await helpers.stateAdapter.getJobs({
          txCtx,
          jobIds: [jobId],
        });
        if (stateJob && stateJob.typeName !== typeName) {
          throw new JobTypeMismatchError(
            `Expected job ${String(jobId)} to have type "${typeName}" but found "${stateJob.typeName}"`,
            { expectedTypeName: typeName, actualTypeName: stateJob.typeName },
          );
        }
      }

      const blockers = await helpers.stateAdapter.getJobBlockers({
        txCtx,
        jobId,
      });
      return blockers.map((stateChain) => mapStateChainToChain(stateChain)) as unknown as TBlockers;
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
        const [stateChain] = await helpers.stateAdapter.getChains({
          txCtx,
          chainIds: [chainId],
        });
        assertChainTypeName(stateChain, { chainId: String(chainId), typeName });
      }

      const stateJobPage = await helpers.stateAdapter.listBlockedJobs({
        txCtx,
        chainId,
        orderDirection,
        page: { cursor, limit },
      });
      return {
        items: stateJobPage.items.map((stateJob) => mapStateJobToJob(stateJob) as TBlockedJob),
        nextCursor: stateJobPage.nextCursor,
      };
    },
  };
  return client;
};
