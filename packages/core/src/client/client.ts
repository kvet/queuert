import { raceWithSleep, setLongTimeout } from "@queuert/helpers/sleep";
import type { IsUnion } from "@queuert/helpers/typescript";
import { type Mode, type ModeResult, step, syncAsync } from "@queuert/sync-async";

import type { ModeOf } from "../adapter-mode.ts";
import type {
  AnyJobOutcomeFields,
  JobOutcomeResult,
  JobOutcome,
  JobRescheduleOutcome,
} from "../attempt/attempt-handler.types.ts";
import { assertChainsTypeName, mapStateChainToChain } from "../entities/chain.ts";
import type { AnyChain, ChainRef } from "../entities/chain.types.ts";
import { assertJobsTypeName, mapStateJobToJob } from "../entities/job.ts";
import type { JobRef } from "../entities/job.types.ts";
import type { OrderDirection, Page } from "../entities/pagination.ts";
import { type Worker, mapStateWorkerToWorker } from "../entities/worker.ts";
import {
  BlockerReferenceError,
  ChainsNotFoundError,
  JobsAlreadyCompletedError,
  JobsStatusMismatchError,
  JobsNotFoundError,
  WaitChainsTimeoutError,
  toSingleChainError,
  toSingleJobError,
} from "../errors.ts";
import type { BaseJobTypeDefinitions } from "../job-types/job-type.ts";
import type {
  BlockerChains,
  JobTypeBlockedNames,
  JobTypeEntryNames,
  JobTypeNames,
  JobTypeReachingEntry,
  NewChain,
  ResolvedChain,
  ResolvedChainJobs,
  ResolvedJob,
} from "../job-types/job-types.resolvers.ts";
import type { JobTypes } from "../job-types/job-types.ts";
import {
  type JobTypesDefinitions,
  type ValidatedSlices,
  mergeJobTypes,
} from "../job-types/merge-job-types.ts";
import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";
import { notifyAfterTransaction } from "../notify-adapter/tx-notifications.ts";
import type { Log } from "../observability-adapter/log.ts";
import type { ObservabilityAdapter } from "../observability-adapter/observability-adapter.ts";
import { completedAttemptSpanResult } from "../observability-adapter/observability-helper.ts";
import type {
  GetStateAdapterJobId,
  GetStateAdapterTxContext,
  GetStateAdapterWorkerId,
  StateAdapter,
  StateChain,
} from "../state-adapter/state-adapter.ts";
import { normalizeTxCtx, requireTxCtx } from "../state-adapter/tx-context.ts";
import { parseJobOutcome, runApplyJobOutcomes, runCreateChains } from "./implementation.ts";
import { type Helpers, createHelpers, runInMode } from "./setup-helpers.ts";

export const helpersSymbol: unique symbol = Symbol("queuert.helpers");

type LockableReadTxContext<TStateAdapter extends StateAdapter<any, any, any, Mode>> =
  | ({ lock?: undefined } & Partial<GetStateAdapterTxContext<TStateAdapter>>)
  | ({ lock: "exclusive" } & GetStateAdapterTxContext<TStateAdapter>);

type ClientJobOutcome<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  true extends IsUnion<TJobTypeName>
    ? JobRescheduleOutcome
    : JobOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;

type ApplyJobOutcomeResult<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TOutcome,
> = TOutcome extends { reschedule: any }
  ? Exclude<
      ResolvedJob<
        GetStateAdapterJobId<TStateAdapter>,
        GetStateAdapterWorkerId<TStateAdapter>,
        TJobTypeDefinitions,
        TJobTypeName
      >,
      { status: "running" | "completed" }
    >
  : JobOutcomeResult<
      TStateAdapter,
      TJobTypeDefinitions,
      TJobTypeName,
      JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
      TOutcome
    >;

type ApplyJobOutcomesSliceItem<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TSliceJobTypeDefinitions extends BaseJobTypeDefinitions,
> = TSliceJobTypeDefinitions extends any
  ? {
      [TJobTypeName in keyof TSliceJobTypeDefinitions & string]: {
        job: JobRef<GetStateAdapterJobId<TStateAdapter>, TJobTypeName>;
      } & JobOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;
    }[keyof TSliceJobTypeDefinitions & string]
  : never;

type ApplyJobOutcomesItem<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
> =
  | ApplyJobOutcomesSliceItem<TStateAdapter, TJobTypeDefinitions, TJobTypeDefinitions>
  | ({
      job: JobRef<GetStateAdapterJobId<TStateAdapter>, JobTypeNames<TJobTypeDefinitions>>;
    } & JobRescheduleOutcome);

type ApplyJobOutcomesItemFor<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TItem,
> = TItem extends {
  job: { typeName: infer TJobTypeName extends JobTypeNames<TJobTypeDefinitions> };
}
  ? {
      job: JobRef<GetStateAdapterJobId<TStateAdapter>, TJobTypeName>;
    } & AcceptReadonlyArrays<ClientJobOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>>
  : {
      job: JobRef<GetStateAdapterJobId<TStateAdapter>, JobTypeNames<TJobTypeDefinitions>>;
    } & JobRescheduleOutcome;

type AcceptReadonlyArrays<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: AcceptReadonlyArrays<T[K]> }
  : T extends Date
    ? T
    : T extends object
      ? { [K in keyof T]: AcceptReadonlyArrays<T[K]> }
      : T;

type ApplyJobOutcomesResult<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TItems extends readonly unknown[],
> = {
  -readonly [K in keyof TItems]: ApplyJobOutcomeResult<
    TStateAdapter,
    TJobTypeDefinitions,
    TItems[K] extends { job: { typeName?: infer TJobTypeName extends string } }
      ? TJobTypeName
      : JobTypeNames<TJobTypeDefinitions>,
    TItems[K]
  >;
};

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
 * - **Mutating** — `createChain`, `createChains`, `applyJobOutcome`, `applyJobOutcomes`, `deleteChain`, `deleteChains`. Require a transaction context; they throw `Error` if called without a transaction context, or with one the state adapter's `getTransaction` reports as outside an open transaction. With an adapter that fences writes (PostgreSQL, SQLite, Redis), all but the deletions throw {@link SchemaFencedError} once a breaking migration fenced this code version, and change nothing.
 * - **Read-only** — `getChain`, `getChains`, `getJob`, `getJobs`, `getChainTypeNames`, `getJobTypeNames`, `countChainsByTypeName`, `countJobsByTypeName`, `listChains`, `listJobs`, `listChainJobs`, `getChainTailJob`, `getChainTailJobs`, `getJobBlockers`, `listBlockedJobs`, `getWorker`, `getWorkers`, `countWorkers`, `countWorkersByTypeName`, `countRunningJobsByWorkerId`, `listWorkers`, `listWorkerJobs`. Accept an optional transaction context; `getChain`, `getChains`, `getJob`, `getJobs`, `getChainTailJob` and `getChainTailJobs` require one with `lock: "exclusive"`.
 * - **Waiting** — `awaitChain`, `awaitChains`. Take no transaction context: they poll outside any transaction and listen for notify adapter events.
 */
export type Client<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobId = GetStateAdapterJobId<TStateAdapter>,
  TWorkerId = GetStateAdapterWorkerId<TStateAdapter>,
  TMode extends Mode = ModeOf<TStateAdapter>,
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
  >(options: {
    chain: ChainRef<TJobId, TChainTypeName>;
    timeoutMs: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
  }) => Promise<
    ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
      status: "completed";
    }
  >;

  /**
   * Wait for every chain to complete, with one notify adapter listener for all the chains and one
   * read of the chains still running per poll. Returns the completed chains in input order; empty
   * `chains` returns `[]`.
   *
   * @throws {@link WaitChainsTimeoutError} on timeout or abort, listing the chains still running.
   * @throws {@link ChainsNotFoundError} if any chain disappears or never existed.
   * @throws {@link ChainsTypeMismatchError} if any chain's `typeName` is provided and does not match.
   */
  awaitChains: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(options: {
    chains: readonly ChainRef<TJobId, TChainTypeName>[];
    timeoutMs: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
  }) => Promise<
    (ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
      status: "completed";
    })[]
  >;

  /**
   * Create a new chain. Returns the created chain with a `deduplicated` flag.
   * Pass `id` to assign a caller-supplied ID for the root job; if the chain is
   * deduplicated, the returned chain carries the existing row's ID, not the
   * caller's.
   *
   * @throws {@link InvalidJobIdError} if `id` fails the state adapter's `validateJobId` check.
   * @throws {@link JobBlockerLimitExceededError} if the root job declares more blockers than the per-job limit.
   * @throws {@link ChainNotFoundError} if a blocker chain does not exist.
   * @throws {@link ChainTypeMismatchError} if a blocker's `typeName` differs from the stored chain's.
   * @throws {@link JobTypeValidationError} if the job type rejects the entry, input, or blockers.
   * @throws {@link UnknownJobTypeError} if a merged registry owns no slice for the job type.
   * @throws TypeError if `deduplication.scope` is missing or not `"running"` / `"any"`.
   * @throws The state adapter's own error (e.g. a unique-constraint violation) if a caller-supplied `id` is already taken.
   */
  createChain: <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
    options: NewChain<TJobId, TJobTypeDefinitions, TChainTypeName> &
      GetStateAdapterTxContext<TStateAdapter>,
  ) => ModeResult<
    TMode,
    ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
      deduplicated: boolean;
    }
  >;

  /**
   * Create multiple chains in a single batch operation. Returns created chains
   * with `deduplicated` flags, in the same order as input. Each item may carry
   * an optional `id`; dedup wins over a caller-supplied id when applicable.
   *
   * @throws {@link InvalidJobIdsError} (listing every offending item) if any `id` fails the state adapter's `validateJobId` check.
   * @throws {@link JobsBlockerLimitExceededError} (listing every offending item) if any root job declares more blockers than the per-job limit.
   * @throws {@link ChainsNotFoundError} (listing every missing id) if any blocker chain does not exist.
   * @throws {@link ChainsTypeMismatchError} (listing every offending id) if any blocker's `typeName` differs from the stored chain's.
   * @throws {@link JobsTypeValidationError} (listing every offending item) if a job type rejects an item's entry, input, or blockers.
   * @throws {@link UnknownJobTypesError} (listing every offending item) if a merged registry owns no slice for an item's type.
   * @throws TypeError if `deduplication.scope` is missing or not `"running"` / `"any"`.
   * @throws The state adapter's own error (e.g. a unique-constraint violation) if a caller-supplied `id` is already taken.
   */
  createChains: <const TChains extends readonly NewChain<TJobId, TJobTypeDefinitions>[]>(
    options: {
      items: TChains;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => ModeResult<TMode, CreateChainsResult<TJobId, TJobTypeDefinitions, TChains>>;

  /**
   * Delete a single chain by ID. Returns the deleted chain, or `undefined` if no
   * chain with that ID exists. A running job's `applyOutcome` throws {@link JobNotFoundError}, and
   * its attempt is notified as lost, so with a notify adapter its handler's `signal` aborts.
   *
   * @throws {@link BlockerReferenceError} if external jobs depend on it.
   */
  deleteChain: <
    TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      id: TJobId;
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => ModeResult<TMode, ResolvedChain<TJobId, TJobTypeDefinitions, TEntryName> | undefined>;

  /**
   * Delete chains by ID. Missing IDs are silently skipped. A running job's `applyOutcome` throws
   * {@link JobNotFoundError}, and its attempt is notified as lost, so with a notify adapter its
   * handler's `signal` aborts.
   *
   * @throws {@link BlockerReferenceError} if external jobs depend on them.
   */
  deleteChains: <
    TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      ids: TJobId[];
    } & GetStateAdapterTxContext<TStateAdapter>,
  ) => ModeResult<TMode, ResolvedChain<TJobId, TJobTypeDefinitions, TEntryName>[]>;

  /**
   * Apply one outcome to a job, the same outcomes an attempt handler's `applyOutcome` takes:
   * `output` completes the job and its chain, `continueWith` completes the job and continues the
   * chain, and `reschedule` brings the job back later. `job` is `{ id, typeName? }` or a job read
   * earlier; with `output` or `continueWith` its `typeName` must name a single job type.
   *
   * The job is locked and validated as stored; a passed `status` must match the stored one, so a job
   * read earlier without a lock that changed since throws instead of being overwritten. `output` and
   * `continueWith` complete a blocked, pending or running job. `reschedule` sets `scheduledAt` on a
   * pending job, moves it on a blocked one, which stays blocked, and returns a running one to
   * pending; `reason` is stored as `lastRescheduleReason`. A running job's attempt is lost either
   * way: its `applyOutcome` throws {@link JobAlreadyCompletedError} after `output` or
   * `continueWith`, and {@link JobTakenByAnotherWorkerError} after `reschedule`. To leave running
   * jobs alone, read with `lock: "exclusive"` and check `status` first.
   *
   * @throws {@link JobNotFoundError} if the job does not exist.
   * @throws {@link JobAlreadyCompletedError} if the job is already completed.
   * @throws {@link JobStatusMismatchError} if `job.status` differs from the stored job's.
   * @throws {@link JobTypeMismatchError} if `job.typeName` differs from the stored job's.
   * @throws {@link JobBlockerLimitExceededError} if a `continueWith` outcome declares more blockers than the per-job limit.
   * @throws {@link ChainNotFoundError} if a `continueWith` blocker chain does not exist.
   * @throws {@link ChainTypeMismatchError} if a `continueWith` blocker's `typeName` differs from the stored chain's.
   * @throws {@link JobTypeValidationError} if the job type rejects the `output`, or the continuation job type rejects the `continueWith` target, input or blockers.
   * @throws {@link UnknownJobTypeError} if a merged registry owns no slice for the job type.
   * @throws {@link InvalidJobIdError} if a `continueWith` `id` fails the state adapter's `validateJobId` check.
   */
  applyJobOutcome: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    const TOutcome extends ClientJobOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName> =
      ClientJobOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>,
  >(
    options: { job: JobRef<TJobId, TJobTypeName> } & TOutcome &
      GetStateAdapterTxContext<TStateAdapter>,
  ) => ModeResult<
    TMode,
    ApplyJobOutcomeResult<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TOutcome>
  >;

  /**
   * Apply an outcome to each of several jobs in one call, each item a `job` with one outcome as in
   * {@link Client.applyJobOutcome | applyJobOutcome}, checked against that item's own `job.typeName`. All or
   * nothing: every job is locked and validated before the first write. Returns the jobs in input order; an
   * array literal of items returns a tuple.
   * Empty `items` returns `[]`.
   *
   * @throws {@link JobsNotFoundError} (listing every offending id) if any job does not exist.
   * @throws {@link JobsAlreadyCompletedError} (listing every offending id) if any job is already completed.
   * @throws {@link JobsStatusMismatchError} (listing every offending id) if any `job.status` differs from the stored job's.
   * @throws {@link JobsTypeMismatchError} (listing every offending id) if any `job.typeName` differs from the stored job's.
   * @throws {@link JobsBlockerLimitExceededError} (listing every offending item) if any `continueWith` outcome declares more blockers than the per-job limit.
   * @throws {@link ChainsNotFoundError} (listing every missing id) if any `continueWith` blocker chain does not exist.
   * @throws {@link ChainsTypeMismatchError} (listing every offending id) if any `continueWith` blocker's `typeName` differs from the stored chain's.
   * @throws {@link JobsTypeValidationError} (listing every offending item) if a job type rejects an `output`, or a continuation job type rejects a `continueWith` target, input or blockers.
   * @throws {@link UnknownJobTypesError} (listing every offending item) if a merged registry owns no slice for an item's type.
   * @throws {@link InvalidJobIdsError} (listing every offending item) if any `continueWith` `id` fails the state adapter's `validateJobId` check.
   * @throws Error if `items` names the same job more than once.
   */
  applyJobOutcomes: <
    const TItems extends readonly { job: JobRef<TJobId, JobTypeNames<TJobTypeDefinitions>> }[] & {
      [K in keyof TItems]: ApplyJobOutcomesItemFor<TStateAdapter, TJobTypeDefinitions, TItems[K]>;
    },
  >(
    options: { items: TItems } & GetStateAdapterTxContext<TStateAdapter>,
  ) => ModeResult<TMode, ApplyJobOutcomesResult<TStateAdapter, TJobTypeDefinitions, TItems>>;

  /**
   * Get a single chain by ID. Pass `typeName` for type narrowing. Pass `lock: "exclusive"` (transaction
   * context required) to lock the chain's head job until the transaction ends.
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
    } & LockableReadTxContext<TStateAdapter>,
  ) => ModeResult<TMode, ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined>;

  /**
   * Get multiple chains by ID. Returns a positional array aligned with the
   * input `ids` — `undefined` for any ID that does not exist. Pass `typeName`
   * to narrow the return type; all found chains must match or
   * {@link ChainsTypeMismatchError} is thrown. Pass `lock: "exclusive"` (transaction context required) to
   * lock each found chain's head job until the transaction ends.
   *
   * @throws {@link ChainsTypeMismatchError} (listing every offending id) if `typeName` is provided and any found chain does not match.
   */
  getChains: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TChainTypeName;
      ids: TJobId[];
    } & LockableReadTxContext<TStateAdapter>,
  ) => ModeResult<
    TMode,
    (ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined)[]
  >;

  /**
   * Get a single job by ID. Pass `typeName` for type narrowing. Pass `lock: "exclusive"` (transaction
   * context required) to lock the job and its chain's head job until the transaction ends.
   *
   * @throws {@link JobTypeMismatchError} if `typeName` is provided and does not match.
   */
  getJob: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TJobTypeName;
      id: TJobId;
    } & LockableReadTxContext<TStateAdapter>,
  ) => ModeResult<
    TMode,
    ResolvedJob<TJobId, TWorkerId, TJobTypeDefinitions, TJobTypeName> | undefined
  >;

  /**
   * Get multiple jobs by ID. Returns a positional array aligned with the
   * input `ids` — `undefined` for any ID that does not exist. Pass `typeName`
   * to narrow the return type; all found jobs must match or
   * {@link JobsTypeMismatchError} is thrown. Pass `lock: "exclusive"` (transaction context required) to lock
   * each found job and its chain's head job until the transaction ends.
   *
   * @throws {@link JobsTypeMismatchError} (listing every offending id) if `typeName` is provided and any found job does not match.
   */
  getJobs: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      typeName?: TJobTypeName;
      ids: TJobId[];
    } & LockableReadTxContext<TStateAdapter>,
  ) => ModeResult<
    TMode,
    (ResolvedJob<TJobId, TWorkerId, TJobTypeDefinitions, TJobTypeName> | undefined)[]
  >;

  /**
   * Get the tail job of a chain: its latest job in chain order, which is the head job while the
   * chain has not continued. Pass `chainTypeName` for type narrowing. Pass `lock: "exclusive"`
   * (transaction context required) to lock the chain's head job and its tail job until the
   * transaction ends, so the tail cannot change before it does. A read that waits on a transaction
   * that continues the chain returns the continuation.
   *
   * @throws {@link ChainTypeMismatchError} if `chainTypeName` is provided and does not match.
   */
  getChainTailJob: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      chainId: TJobId;
      chainTypeName?: TChainTypeName;
    } & LockableReadTxContext<TStateAdapter>,
  ) => ModeResult<
    TMode,
    ResolvedChainJobs<TJobId, TWorkerId, TJobTypeDefinitions, TChainTypeName> | undefined
  >;

  /**
   * Get the tail jobs of multiple chains in one state adapter read. Returns a positional array
   * aligned with the input `chainIds` — `undefined` for any chain that does not exist. Pass
   * `chainTypeName` to narrow the return type; all found chains must match or
   * {@link ChainsTypeMismatchError} is thrown. Pass `lock: "exclusive"` (transaction context required) to
   * lock each found chain's head job and tail job until the transaction ends; a read that waits on
   * a transaction that continues a chain returns the continuation.
   *
   * @throws {@link ChainsTypeMismatchError} (listing every offending id) if `chainTypeName` is provided and any found chain does not match.
   */
  getChainTailJobs: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options: {
      chainIds: TJobId[];
      chainTypeName?: TChainTypeName;
    } & LockableReadTxContext<TStateAdapter>,
  ) => ModeResult<
    TMode,
    (ResolvedChainJobs<TJobId, TWorkerId, TJobTypeDefinitions, TChainTypeName> | undefined)[]
  >;

  /** Get a worker by ID, `undefined` when it has no row: it stopped or its lease was reclaimed. */
  getWorker: (
    options: { id: TWorkerId } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<TMode, Worker<TWorkerId> | undefined>;

  /**
   * Get multiple workers by ID. Returns a positional array aligned with the input `ids` —
   * `undefined` for any ID with no row.
   */
  getWorkers: (
    options: { ids: TWorkerId[] } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<TMode, (Worker<TWorkerId> | undefined)[]>;

  /**
   * Returns distinct chain type names present in the data, sorted alphabetically.
   */
  getChainTypeNames: <
    TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
      JobTypeEntryNames<TJobTypeDefinitions>,
  >(
    options?: Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<TMode, TChainTypeName[]>;

  /**
   * Returns distinct job type names present in the data, sorted alphabetically.
   */
  getJobTypeNames: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options?: Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<TMode, TJobTypeName[]>;

  /**
   * Returns capped per-status counts for the given chain type names, in input order.
   */
  countChainsByTypeName: (
    options: {
      typeNames: JobTypeEntryNames<TJobTypeDefinitions>[];
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<
    TMode,
    {
      running: { count: number; hasMore: boolean };
      completed: { count: number; hasMore: boolean };
    }[]
  >;

  /**
   * Returns capped per-status counts for the given job type names, in input order.
   */
  countJobsByTypeName: (
    options: {
      typeNames: JobTypeNames<TJobTypeDefinitions>[];
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<
    TMode,
    {
      blocked: { count: number; hasMore: boolean };
      pending: { count: number; hasMore: boolean };
      running: { count: number; hasMore: boolean };
      completed: { count: number; hasMore: boolean };
    }[]
  >;

  /** Count the workers with a live lease and the expired ones not reclaimed yet. */
  countWorkers: (
    options?: Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<TMode, { live: number; expired: number }>;

  /** Count, for each job type name in input order, the live and expired workers that process it. */
  countWorkersByTypeName: (
    options: { typeNames: string[] } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<TMode, { live: number; expired: number }[]>;

  /** Count the jobs running under each worker ID, in input order. */
  countRunningJobsByWorkerId: (
    options: { workerIds: TWorkerId[] } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<TMode, number[]>;

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
      blocking?: boolean;
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
  ) => ModeResult<TMode, Page<ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName>>>;

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
      | { status: "running"; orderBy?: "createdAt" | "attemptAt" }
      | { status: "completed"; orderBy?: "createdAt" | "completedAt" }
    ) &
      Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<TMode, Page<ResolvedJob<TJobId, TWorkerId, TJobTypeDefinitions, TJobTypeName>>>;

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
  ) => ModeResult<
    TMode,
    Page<ResolvedChainJobs<TJobId, TWorkerId, TJobTypeDefinitions, TChainTypeName>>
  >;

  /**
   * Get the blocker chains for a specific job. Not paginated — blockers are
   * bounded by design. Pass `typeName` for type narrowing.
   *
   * @throws {@link JobTypeMismatchError} if `typeName` is provided and does not match.
   */
  getJobBlockers: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- a defaulted result type the caller may narrow; the sync variant uses it once
    TBlockers extends readonly unknown[] = BlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName>,
  >(
    options: {
      jobId: TJobId;
      typeName?: TJobTypeName;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<TMode, TBlockers>;

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
      TWorkerId,
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
  ) => ModeResult<TMode, Page<TBlockedJob>>;

  /**
   * List workers with cursor-based pagination, ordered by `startedAt`, then id. Defaults to
   * `orderDirection: "asc"` and `limit: 50`. Pass `typeName` for only the workers that process
   * it. Includes workers whose lease is no longer live and that were not reclaimed yet.
   */
  listWorkers: (
    options?: {
      typeName?: string;
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<TMode, Page<Worker<TWorkerId>>>;

  /**
   * List the jobs running under a worker with cursor-based pagination, ordered by `attemptAt`,
   * then id, whether or not the worker still has a row. Defaults to `orderDirection: "asc"` and
   * `limit: 50`.
   */
  listWorkerJobs: <
    TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
  >(
    options: {
      workerId: TWorkerId;
      orderDirection?: OrderDirection;
      cursor?: string;
      limit?: number;
    } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
  ) => ModeResult<TMode, Page<ResolvedJob<TJobId, TWorkerId, TJobTypeDefinitions, TJobTypeName>>>;
};

/**
 * Create a new Queuert client.
 *
 * The client follows its state adapter's mode. Over an async {@link StateAdapter} its
 * state-touching methods return promises. Over a `"sync"` one (better-sqlite3, node:sqlite,
 * bun:sqlite) they return their results directly and throw synchronously, so Queuert's writes join
 * the driver's own transaction, such as `db.transaction(() => …)()`, and a failure rolls it back.
 * `awaitChain` and `awaitChains` return a promise in both modes: they wait on notifications and poll.
 *
 * @param options - Client configuration.
 */
export const createClient = <
  const TJobTypes extends JobTypes<any> | readonly [JobTypes<any>, ...JobTypes<any>[]],
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
>({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  jobTypes: jobTypesOption,
  log,
}: {
  /** Database adapter for job persistence. Its mode sets the client's mode. */
  stateAdapter: TStateAdapter;
  /**
   * Pub/sub adapter that wakes workers and `awaitChain` callers when jobs are scheduled or chains
   * complete. Over an async state adapter it may be of either mode; over a sync state adapter it
   * must be sync too. Defaults to an in-process adapter that reaches only the worker runners
   * created from this client; pass one shared across processes for workers in other processes,
   * which otherwise poll: PostgreSQL, Redis, NATS, or IPC for processes on one host.
   *
   * @throws Error if the state adapter is sync and the notify adapter is not.
   */
  notifyAdapter?: ModeOf<TStateAdapter> extends "sync"
    ? NotifyAdapter<"sync">
    : NotifyAdapter<Mode>;
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
}): Client<JobTypesDefinitions<TJobTypes>, TStateAdapter> => {
  type TJobTypeDefinitions = JobTypesDefinitions<TJobTypes>;
  type TJobId = GetStateAdapterJobId<TStateAdapter>;
  type TWorkerId = GetStateAdapterWorkerId<TStateAdapter>;
  type TMode = ModeOf<TStateAdapter>;

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
  }) as Helpers<TMode>;

  const client: Client<TJobTypeDefinitions, TStateAdapter> = {
    [helpersSymbol]: helpers,

    createChain: <TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions>>(
      options: NewChain<TJobId, TJobTypeDefinitions, TChainTypeName> &
        GetStateAdapterTxContext<TStateAdapter>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { input, id, typeName, deduplication, schedule, blockers, ...rest } = options;
          const txCtx = requireTxCtx(helpers.stateAdapter, rest, "createChain");
          try {
            const [result] = yield* runCreateChains.steps(helpers, {
              chains: [{ typeName, id, input, deduplication, schedule, blockers }],
              txCtx,
            });
            return result as ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & {
              deduplicated: boolean;
            };
          } catch (error) {
            throw toSingleChainError(toSingleJobError(error));
          }
        }),
      ),

    createChains: <const TChains extends readonly NewChain<TJobId, TJobTypeDefinitions>[]>(
      options: {
        items: TChains;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { items, ...rest } = options;
          const txCtx = requireTxCtx(helpers.stateAdapter, rest, "createChains");
          const created = yield* runCreateChains.steps(helpers, {
            chains: items,
            txCtx,
          });
          return created as unknown as CreateChainsResult<TJobId, TJobTypeDefinitions, TChains>;
        }),
      ),

    deleteChain: <
      TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        id: TJobId;
      } & GetStateAdapterTxContext<TStateAdapter>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { id, ...rest } = options;
          const deleted = yield* step(
            client.deleteChains<TEntryName>({
              ids: [id],
              ...(rest as GetStateAdapterTxContext<TStateAdapter>),
            }),
          );
          return deleted.find((chain) => chain.id === id);
        }),
      ),

    deleteChains: <
      TEntryName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        ids: TJobId[];
      } & GetStateAdapterTxContext<TStateAdapter>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { ids, ...rest } = options;
          const txCtx = requireTxCtx(helpers.stateAdapter, rest, "deleteChains");

          const verdicts = yield* step(
            helpers.stateAdapter.deleteChains({
              txCtx,
              chainIds: ids,
            }),
          );
          const blockerRefs = verdicts.flatMap((verdict) =>
            Array.isArray(verdict)
              ? verdict.map((blockedJob) => ({
                  chainId: blockedJob.blockedByChainId,
                  referencedByJobId: blockedJob.jobId,
                }))
              : [],
          );
          if (blockerRefs.length > 0) {
            const lockedChains = yield* step(
              helpers.stateAdapter.getChains({ txCtx, chainIds: ids }),
            );
            notifyAfterTransaction(helpers, txCtx, {
              lockedPendingJobs: lockedChains.flatMap((chain) => {
                const currentJob = chain?.tail ?? chain?.head;
                return currentJob?.status === "pending" ? [currentJob] : [];
              }),
            });
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
                mapStateChainToChain(stateChain, helpers.jobTypes) as ResolvedChain<
                  TJobId,
                  TJobTypeDefinitions,
                  TEntryName
                >,
            );

          for (const stateChain of verdicts) {
            if (stateChain !== undefined && !Array.isArray(stateChain)) {
              helpers.stateAdapter.onTransactionCommit(txCtx, () => {
                helpers.observabilityHelper.chainDeleted(stateChain);
              });
            }
          }
          const deletedPendingJobs = verdicts.flatMap((verdict) => {
            if (verdict === undefined || Array.isArray(verdict)) return [];
            const currentJob = verdict.tail ?? verdict.head;
            return currentJob.status === "pending" ? [currentJob] : [];
          });
          notifyAfterTransaction(helpers, txCtx, {
            lockedPendingJobs: deletedPendingJobs,
            settledJobIds: verdicts.flatMap((verdict) =>
              verdict === undefined || Array.isArray(verdict)
                ? []
                : [verdict.head.id, ...(verdict.tail ? [verdict.tail.id] : [])],
            ),
            jobAttemptsLost: verdicts
              .flatMap((verdict) =>
                verdict !== undefined && !Array.isArray(verdict)
                  ? [verdict.head, verdict.tail]
                  : [],
              )
              .flatMap((stateJob) => (stateJob?.status === "running" ? [stateJob.id] : [])),
          });

          return deletedChains;
        }),
      ),

    applyJobOutcome: <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: { job: JobRef<TJobId, TJobTypeName> } & ClientJobOutcome<
        TStateAdapter,
        TJobTypeDefinitions,
        TJobTypeName
      > &
        GetStateAdapterTxContext<TStateAdapter>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { job, output, continueWith, reschedule, reason, ...txCtx } = options as {
            job: JobRef<TJobId, TJobTypeName>;
          } & AnyJobOutcomeFields;
          const item = {
            job,
            ...("output" in options && { output }),
            ...("continueWith" in options && { continueWith }),
            ...("reschedule" in options && { reschedule }),
            ...(reason !== undefined && { reason }),
          };
          try {
            const [applied] = yield* step(
              client.applyJobOutcomes({
                ...(txCtx as GetStateAdapterTxContext<TStateAdapter>),
                items: [item as ApplyJobOutcomesItem<TStateAdapter, TJobTypeDefinitions>],
              }),
            );
            return applied;
          } catch (error) {
            throw toSingleChainError(toSingleJobError(error));
          }
        }),
      ),

    applyJobOutcomes: <
      const TItems extends readonly { job: JobRef<TJobId, JobTypeNames<TJobTypeDefinitions>> }[] & {
        [K in keyof TItems]: ApplyJobOutcomesItemFor<TStateAdapter, TJobTypeDefinitions, TItems[K]>;
      },
    >(
      options: { items: TItems } & GetStateAdapterTxContext<TStateAdapter>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { items, ...rest } = options;
          const txCtx = requireTxCtx(helpers.stateAdapter, rest, "applyJobOutcomes");
          if (items.length === 0) {
            return [] as unknown as ApplyJobOutcomesResult<
              TStateAdapter,
              TJobTypeDefinitions,
              TItems
            >;
          }

          const typedItems = items as readonly ({
            job: JobRef<TJobId, string>;
          } & AnyJobOutcomeFields)[];
          const parsedItems = typedItems.map((item) => ({
            job: item.job,
            outcome: parseJobOutcome(item, "applyJobOutcomes"),
          }));
          const jobIds = parsedItems.map(({ job }) => job.id);
          if (new Set(jobIds).size !== jobIds.length) {
            throw new Error("applyJobOutcomes requires each job at most once");
          }

          const stateJobs = yield* step(
            helpers.stateAdapter.getJobs({ txCtx, jobIds, lock: "exclusive" }),
          );
          notifyAfterTransaction(helpers, txCtx, {
            lockedPendingJobs: stateJobs.flatMap((job) => (job?.status === "pending" ? [job] : [])),
          });
          const assertApplicable = (): void => {
            const notFound = jobIds.filter((_, index) => stateJobs[index] === undefined);
            if (notFound.length > 0) {
              throw new JobsNotFoundError(`Jobs not found: ${notFound.join(", ")}`, {
                jobIds: notFound,
              });
            }
            const alreadyCompleted = jobIds.filter(
              (_, index) => stateJobs[index]!.status === "completed",
            );
            if (alreadyCompleted.length > 0) {
              throw new JobsAlreadyCompletedError(
                `Cannot apply outcomes to jobs that are already completed: ${alreadyCompleted.join(", ")}`,
                { jobIds: alreadyCompleted },
              );
            }
            const changed = parsedItems.flatMap(({ job: { id, status } }, index) =>
              status !== undefined && stateJobs[index]!.status !== status
                ? [{ id, expectedStatus: status, actualStatus: stateJobs[index]!.status }]
                : [],
            );
            if (changed.length > 0) {
              throw new JobsStatusMismatchError(
                `Jobs changed status since they were read: ${changed.map(({ id }) => id).join(", ")}`,
                {
                  jobIds: changed.map(({ id }) => id),
                  expectedStatuses: changed.map(({ expectedStatus }) => expectedStatus),
                  actualStatuses: changed.map(({ actualStatus }) => actualStatus),
                },
              );
            }
            assertJobsTypeName(stateJobs, {
              jobIds,
              typeNames: parsedItems.map(({ job }) => job.typeName),
            });
          };

          assertApplicable();
          const applied = yield* runApplyJobOutcomes.steps(helpers, {
            txCtx,
            items: parsedItems.map(({ outcome }, index) => ({ job: stateJobs[index]!, outcome })),
          });
          notifyAfterTransaction(helpers, txCtx, {
            settledJobIds: jobIds,
            jobAttemptsLost: applied.flatMap((written, index) =>
              written !== undefined && stateJobs[index]!.status === "running" ? [written.id] : [],
            ),
          });

          return applied.map((written, index) => {
            if (written === undefined) {
              throw new Error(`Job ${jobIds[index]} changed under its lock`);
            }
            helpers.stateAdapter.onTransactionCommit(txCtx, () => {
              helpers.observabilityHelper
                .startAttemptSpan(written, { workerId: null })
                ?.end(completedAttemptSpanResult(written));
            });
            return mapStateJobToJob(written, helpers.jobTypes);
          }) as unknown as ApplyJobOutcomesResult<TStateAdapter, TJobTypeDefinitions, TItems>;
        }),
      ),

    awaitChain: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(options: {
      chain: ChainRef<TJobId, TChainTypeName>;
      timeoutMs: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
    }): Promise<
      ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & { status: "completed" }
    > => {
      const { chain, ...waitOptions } = options;
      try {
        const [completedChain] = await client.awaitChains<TChainTypeName>({
          chains: [chain],
          ...waitOptions,
        });
        return completedChain;
      } catch (error) {
        throw toSingleChainError(error);
      }
    },

    awaitChains: async <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(options: {
      chains: readonly ChainRef<TJobId, TChainTypeName>[];
      timeoutMs: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
    }): Promise<
      (ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> & { status: "completed" })[]
    > => {
      const { chains, timeoutMs, pollIntervalMs = 15_000, signal } = options;
      if (chains.length === 0) return [];
      const chainIds = chains.map(({ id }) => id);
      const typeNames = chains.map(({ typeName }) => typeName);

      const uniqueChainIds = [...new Set(chainIds)];
      const completedChains = new Map<string, AnyChain>();

      const readChains = async (ids: TJobId[]) => {
        const stateChains = await helpers.stateAdapter.getChains({ chainIds: ids });
        const missingChainIds = [
          ...new Set(ids.filter((_, index) => stateChains[index] === undefined)),
        ];
        if (missingChainIds.length > 0) {
          throw new ChainsNotFoundError(`Chains not found: ${missingChainIds.join(", ")}`, {
            chainIds: missingChainIds,
          });
        }
        return stateChains.filter((stateChain) => stateChain !== undefined);
      };
      const recordCompleted = (stateChains: StateChain[]): void => {
        for (const stateChain of stateChains) {
          if (stateChain.status === "completed") {
            completedChains.set(stateChain.id, mapStateChainToChain(stateChain, helpers.jobTypes));
          }
        }
      };
      const runningChainIds = () => uniqueChainIds.filter((id) => !completedChains.has(id));

      const timeoutController = new AbortController();
      const clearTimeoutTimer = setLongTimeout(() => {
        timeoutController.abort();
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

      try {
        const dispose = await helpers.notifyHelper.listenChainsCompleted(uniqueChainIds, () => {
          resolveNotification?.();
        });
        try {
          const firstChains = await readChains(chainIds);
          assertChainsTypeName(firstChains, { chainIds, typeNames });
          recordCompleted(firstChains);
          while (runningChainIds().length > 0 && !combinedSignal.aborted) {
            await raceWithSleep(notificationPromise, pollIntervalMs, { signal: combinedSignal });
            resetNotificationPromise();
            recordCompleted(await readChains(runningChainIds()));
          }

          const stillRunningChainIds = runningChainIds();
          if (stillRunningChainIds.length === 0) {
            return chainIds.map((id) => completedChains.get(id)) as (ResolvedChain<
              TJobId,
              TJobTypeDefinitions,
              TChainTypeName
            > & { status: "completed" })[];
          }
          throw new WaitChainsTimeoutError(
            signal?.aborted
              ? `Wait for chains ${stillRunningChainIds.join(", ")} was aborted`
              : `Timeout waiting for chains ${stillRunningChainIds.join(", ")} to complete after ${timeoutMs}ms`,
            { chainIds: stillRunningChainIds, timeoutMs, cause: signal?.reason },
          );
        } finally {
          await dispose();
        }
      } finally {
        clearTimeoutTimer();
      }
    },

    getChain: <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName?: TChainTypeName;
        id: TJobId;
        lock?: "exclusive";
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { id, typeName, ...rest } = options;
          try {
            const [chain] = yield* step(
              client.getChains<TChainTypeName>({
                typeName,
                ids: [id],
                ...(rest as LockableReadTxContext<TStateAdapter>),
              }),
            );
            return chain;
          } catch (error) {
            throw toSingleChainError(error);
          }
        }),
      ),

    getChains: <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName?: TChainTypeName;
        ids: TJobId[];
        lock?: "exclusive";
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { ids, typeName, lock, ...rest } = options;

          if (ids.length === 0) {
            return [] as (ResolvedChain<TJobId, TJobTypeDefinitions, TChainTypeName> | undefined)[];
          }

          const lockedTxCtx =
            lock === "exclusive"
              ? requireTxCtx(helpers.stateAdapter, rest, "getChains")
              : undefined;
          const stateChains = yield* step(
            lockedTxCtx !== undefined
              ? helpers.stateAdapter.getChains({
                  txCtx: lockedTxCtx,
                  chainIds: ids,
                  lock: "exclusive",
                })
              : helpers.stateAdapter.getChains({ txCtx: normalizeTxCtx(rest), chainIds: ids }),
          );
          if (lockedTxCtx !== undefined) {
            notifyAfterTransaction(helpers, lockedTxCtx, {
              lockedPendingJobs: stateChains.flatMap((stateChain) =>
                stateChain?.head.status === "pending" ? [stateChain.head] : [],
              ),
            });
          }
          if (typeName !== undefined) {
            assertChainsTypeName(stateChains, {
              chainIds: ids,
              typeNames: ids.map(() => typeName),
            });
          }

          return stateChains.map((stateChain) => {
            if (!stateChain) return undefined;

            return mapStateChainToChain(stateChain, helpers.jobTypes) as ResolvedChain<
              TJobId,
              TJobTypeDefinitions,
              TChainTypeName
            >;
          });
        }),
      ),

    getJob: <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName?: TJobTypeName;
        id: TJobId;
        lock?: "exclusive";
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { id, typeName, ...rest } = options;
          try {
            const [job] = yield* step(
              client.getJobs<TJobTypeName>({
                typeName,
                ids: [id],
                ...(rest as LockableReadTxContext<TStateAdapter>),
              }),
            );
            return job;
          } catch (error) {
            throw toSingleJobError(error);
          }
        }),
      ),

    getJobs: <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName?: TJobTypeName;
        ids: TJobId[];
        lock?: "exclusive";
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { ids, typeName, lock, ...rest } = options;

          if (ids.length === 0) {
            return [] as (
              | ResolvedJob<TJobId, TWorkerId, TJobTypeDefinitions, TJobTypeName>
              | undefined
            )[];
          }

          const lockedTxCtx =
            lock === "exclusive" ? requireTxCtx(helpers.stateAdapter, rest, "getJobs") : undefined;
          const stateJobs = yield* step(
            lockedTxCtx !== undefined
              ? helpers.stateAdapter.getJobs({
                  txCtx: lockedTxCtx,
                  jobIds: ids,
                  lock: "exclusive",
                })
              : helpers.stateAdapter.getJobs({ txCtx: normalizeTxCtx(rest), jobIds: ids }),
          );
          if (lockedTxCtx !== undefined) {
            notifyAfterTransaction(helpers, lockedTxCtx, {
              lockedPendingJobs: stateJobs.flatMap((stateJob) =>
                stateJob?.status === "pending" ? [stateJob] : [],
              ),
            });
          }
          assertJobsTypeName(stateJobs, { jobIds: ids, typeNames: ids.map(() => typeName) });

          return stateJobs.map((stateJob) => {
            if (!stateJob) return undefined;

            return mapStateJobToJob(stateJob, helpers.jobTypes) as ResolvedJob<
              TJobId,
              TWorkerId,
              TJobTypeDefinitions,
              TJobTypeName
            >;
          });
        }),
      ),

    getChainTailJob: <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        chainId: TJobId;
        chainTypeName?: TChainTypeName;
        lock?: "exclusive";
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { chainId, chainTypeName, ...rest } = options;
          try {
            const [tailJob] = yield* step(
              client.getChainTailJobs<TChainTypeName>({
                chainIds: [chainId],
                chainTypeName,
                ...(rest as LockableReadTxContext<TStateAdapter>),
              }),
            );
            return tailJob;
          } catch (error) {
            throw toSingleChainError(error);
          }
        }),
      ),

    getChainTailJobs: <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        chainIds: TJobId[];
        chainTypeName?: TChainTypeName;
        lock?: "exclusive";
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { chainIds, chainTypeName, lock, ...rest } = options;

          if (chainIds.length === 0) {
            return [] as (
              | ResolvedChainJobs<TJobId, TWorkerId, TJobTypeDefinitions, TChainTypeName>
              | undefined
            )[];
          }

          const lockedTxCtx =
            lock === "exclusive"
              ? requireTxCtx(helpers.stateAdapter, rest, "getChainTailJobs")
              : undefined;
          const tailJobs = yield* step(
            lockedTxCtx !== undefined
              ? helpers.stateAdapter.getChainTails({
                  txCtx: lockedTxCtx,
                  chainIds,
                  lock: "exclusive",
                })
              : helpers.stateAdapter.getChainTails({ txCtx: normalizeTxCtx(rest), chainIds }),
          );
          if (lockedTxCtx !== undefined) {
            notifyAfterTransaction(helpers, lockedTxCtx, {
              lockedPendingJobs: tailJobs.flatMap((tailJob) =>
                tailJob?.status === "pending" ? [tailJob] : [],
              ),
            });
          }
          if (chainTypeName !== undefined) {
            assertChainsTypeName(
              tailJobs.map((tailJob) => tailJob?.chain),
              { chainIds, typeNames: chainIds.map(() => chainTypeName) },
            );
          }

          return tailJobs.map((tailJob) => {
            if (!tailJob) return undefined;

            return mapStateJobToJob(tailJob, helpers.jobTypes) as ResolvedChainJobs<
              TJobId,
              TWorkerId,
              TJobTypeDefinitions,
              TChainTypeName
            >;
          });
        }),
      ),

    getWorker: ({ id, ...rest }) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const [worker] = yield* step(
            client.getWorkers({
              ids: [id],
              ...(rest as Partial<GetStateAdapterTxContext<TStateAdapter>>),
            }),
          );
          return worker;
        }),
      ),

    getWorkers: ({ ids, ...rest }) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          if (ids.length === 0) return [] as (Worker<TWorkerId> | undefined)[];
          const stateWorkers = yield* step(
            helpers.stateAdapter.getWorkers({
              txCtx: normalizeTxCtx(rest),
              workerIds: ids,
            }),
          );
          return stateWorkers.map((stateWorker) =>
            stateWorker ? (mapStateWorkerToWorker(stateWorker) as Worker<TWorkerId>) : undefined,
          );
        }),
      ),

    getChainTypeNames: <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options?: Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const txCtx = options ? normalizeTxCtx(options as Record<string, unknown>) : undefined;
          const names = yield* step(helpers.stateAdapter.getChainTypeNames({ txCtx }));
          return names.sort() as TChainTypeName[];
        }),
      ),

    getJobTypeNames: <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options?: Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const txCtx = options ? normalizeTxCtx(options as Record<string, unknown>) : undefined;
          const names = yield* step(helpers.stateAdapter.getJobTypeNames({ txCtx }));
          return names.sort() as TJobTypeName[];
        }),
      ),

    countJobsByTypeName: ({ typeNames, ...rest }) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          return yield* step(
            helpers.stateAdapter.countJobsByTypeName({
              txCtx: normalizeTxCtx(rest as Record<string, unknown>),
              typeNames,
            }),
          );
        }),
      ),

    countChainsByTypeName: ({ typeNames, ...rest }) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          return yield* step(
            helpers.stateAdapter.countChainsByTypeName({
              txCtx: normalizeTxCtx(rest as Record<string, unknown>),
              typeNames,
            }),
          );
        }),
      ),

    countWorkers: (options) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          return yield* step(
            helpers.stateAdapter.countWorkers({ txCtx: normalizeTxCtx(options ?? {}) }),
          );
        }),
      ),

    countWorkersByTypeName: ({ typeNames, ...rest }) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          return yield* step(
            helpers.stateAdapter.countWorkersByTypeName({ txCtx: normalizeTxCtx(rest), typeNames }),
          );
        }),
      ),

    countRunningJobsByWorkerId: ({ workerIds, ...rest }) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          return yield* step(
            helpers.stateAdapter.countRunningJobsByWorkerId({
              txCtx: normalizeTxCtx(rest),
              workerIds,
            }),
          );
        }),
      ),

    listChains: <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
    >(
      options: {
        typeName: TChainTypeName;
        blocking?: boolean;
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
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const {
            typeName,
            blocking,
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

          const result = yield* step(
            helpers.stateAdapter.listChains({
              txCtx,
              typeName,
              blocking,
              from,
              to,
              status,
              orderBy: orderBy ?? (status === "completed" ? "completedAt" : "createdAt"),
              orderDirection,
              page: { cursor, limit },
            } as Parameters<typeof helpers.stateAdapter.listChains>[0]),
          );
          return {
            items: result.items.map(
              (stateChain) =>
                mapStateChainToChain(stateChain, helpers.jobTypes) as ResolvedChain<
                  TJobId,
                  TJobTypeDefinitions,
                  TChainTypeName
                >,
            ),
            nextCursor: result.nextCursor,
          };
        }),
      ),

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
        | { status: "running"; orderBy?: "createdAt" | "attemptAt" }
        | { status: "completed"; orderBy?: "createdAt" | "completedAt" }
      ) &
        Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
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

          const result = yield* step(
            helpers.stateAdapter.listJobs({
              txCtx,
              typeName,
              from,
              to,
              status,
              orderBy: resolvedOrderBy,
              orderDirection,
              page: { cursor, limit },
            } as Parameters<typeof helpers.stateAdapter.listJobs>[0]),
          );
          return {
            items: result.items.map(
              (stateJob) =>
                mapStateJobToJob(stateJob, helpers.jobTypes) as ResolvedJob<
                  TJobId,
                  TWorkerId,
                  TJobTypeDefinitions,
                  TJobTypeName
                >,
            ),
            nextCursor: result.nextCursor,
          };
        }),
      ),

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
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
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
            const [stateChain] = yield* step(
              helpers.stateAdapter.getChains({
                txCtx,
                chainIds: [chainId],
              }),
            );
            try {
              assertChainsTypeName([stateChain], {
                chainIds: [chainId],
                typeNames: [chainTypeName],
              });
            } catch (error) {
              throw toSingleChainError(error);
            }
          }
          const result = yield* step(
            helpers.stateAdapter.listChainJobs({
              txCtx,
              chainId,
              orderDirection,
              page: { cursor, limit },
            }),
          );
          return {
            items: result.items.map(
              (stateJob) =>
                mapStateJobToJob(stateJob, helpers.jobTypes) as ResolvedChainJobs<
                  TJobId,
                  TWorkerId,
                  TJobTypeDefinitions,
                  TChainTypeName
                >,
            ),
            nextCursor: result.nextCursor,
          };
        }),
      ),

    getJobBlockers: <
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
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { jobId, typeName, ...rest } = options;
          const txCtx = normalizeTxCtx(rest);

          if (typeName) {
            const [stateJob] = yield* step(
              helpers.stateAdapter.getJobs({
                txCtx,
                jobIds: [jobId],
              }),
            );
            try {
              assertJobsTypeName([stateJob], { jobIds: [jobId], typeNames: [typeName] });
            } catch (error) {
              throw toSingleJobError(error);
            }
          }
          const [blockers] = yield* step(
            helpers.stateAdapter.getJobsBlockers({
              txCtx,
              jobIds: [jobId],
            }),
          );
          return blockers.map((stateChain) =>
            mapStateChainToChain(stateChain, helpers.jobTypes),
          ) as unknown as TBlockers;
        }),
      ),

    listBlockedJobs: <
      TChainTypeName extends JobTypeEntryNames<TJobTypeDefinitions> =
        JobTypeEntryNames<TJobTypeDefinitions>,
      // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- see the `Client` declaration
      TBlockedJob = ResolvedJob<
        TJobId,
        TWorkerId,
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
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const {
            chainId,
            typeName,
            orderDirection = "desc",
            cursor,
            limit = 50,
            ...rest
          } = options;
          const txCtx = normalizeTxCtx(rest);

          if (typeName) {
            const [stateChain] = yield* step(
              helpers.stateAdapter.getChains({
                txCtx,
                chainIds: [chainId],
              }),
            );
            try {
              assertChainsTypeName([stateChain], { chainIds: [chainId], typeNames: [typeName] });
            } catch (error) {
              throw toSingleChainError(error);
            }
          }
          const stateJobPage = yield* step(
            helpers.stateAdapter.listBlockedJobs({
              txCtx,
              chainId,
              orderDirection,
              page: { cursor, limit },
            }),
          );
          return {
            items: stateJobPage.items.map(
              (stateJob) => mapStateJobToJob(stateJob, helpers.jobTypes) as TBlockedJob,
            ),
            nextCursor: stateJobPage.nextCursor,
          };
        }),
      ),

    listWorkers: (options) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { typeName, orderDirection = "asc", cursor, limit = 50, ...rest } = options ?? {};
          const stateWorkerPage = yield* step(
            helpers.stateAdapter.listWorkers({
              txCtx: normalizeTxCtx(rest),
              typeName,
              orderDirection,
              page: { cursor, limit },
            }),
          );
          return {
            items: stateWorkerPage.items.map(
              (stateWorker) => mapStateWorkerToWorker(stateWorker) as Worker<TWorkerId>,
            ),
            nextCursor: stateWorkerPage.nextCursor,
          };
        }),
      ),

    listWorkerJobs: <
      TJobTypeName extends JobTypeNames<TJobTypeDefinitions> = JobTypeNames<TJobTypeDefinitions>,
    >(
      options: {
        workerId: TWorkerId;
        orderDirection?: OrderDirection;
        cursor?: string;
        limit?: number;
      } & Partial<GetStateAdapterTxContext<TStateAdapter>>,
    ) =>
      runInMode(
        helpers,
        syncAsync(function* () {
          const { workerId, orderDirection = "asc", cursor, limit = 50, ...rest } = options;
          const stateJobPage = yield* step(
            helpers.stateAdapter.listWorkerJobs({
              txCtx: normalizeTxCtx(rest),
              workerId,
              orderDirection,
              page: { cursor, limit },
            }),
          );
          return {
            items: stateJobPage.items.map(
              (stateJob) =>
                mapStateJobToJob(stateJob, helpers.jobTypes) as ResolvedJob<
                  TJobId,
                  TWorkerId,
                  TJobTypeDefinitions,
                  TJobTypeName
                >,
            ),
            nextCursor: stateJobPage.nextCursor,
          };
        }),
      ),
  };
  return client;
};
