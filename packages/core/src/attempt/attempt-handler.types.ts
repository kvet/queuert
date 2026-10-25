import { type AnyChain } from "../entities/chain.js";
import { type AnyJob } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type BaseJobTypeDefinitions } from "../job-types/job-type.js";
import {
  type AnyNewJob,
  type ContinuedJob,
  type JobTypeContinuation,
  type JobTypeProperty,
  type NewJob,
  type OutputJob,
  type RescheduledJob,
  type ResolvedRunningJob,
} from "../job-types/job-types.resolvers.js";
import {
  type BaseTxContext,
  type GetStateAdapterJobId,
  type GetStateAdapterMode,
  type GetStateAdapterTxContext,
  type StateAdapter,
  type StateAdapterMode,
  type StateResult,
} from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

type AttemptContinueWithOutcome<
  TStateAdapter extends StateAdapter<any, any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  JobTypeContinuation<TJobTypeDefinitions, TJobTypeName> extends never
    ? never
    : {
        continueWith: {
          [TContinuationTypeName in JobTypeContinuation<TJobTypeDefinitions, TJobTypeName>]: NewJob<
            GetStateAdapterJobId<TStateAdapter>,
            TJobTypeDefinitions,
            TContinuationTypeName
          >;
        }[JobTypeContinuation<TJobTypeDefinitions, TJobTypeName>];
      };

type AttemptOutputOutcome<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "output"> extends never
    ? never
    : {
        output: JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "output">;
      };

type AttemptRescheduleOutcome = { reschedule: ScheduleOptions };

/** Every outcome `complete` accepts, as a single union. */
export type AttemptOutcome<
  TStateAdapter extends StateAdapter<any, any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  | AttemptOutputOutcome<TJobTypeDefinitions, TJobTypeName>
  | AttemptContinueWithOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>
  | AttemptRescheduleOutcome;

/** Resolves the committed job shape from the outcome's discriminant key. */
export type AttemptCompleteResult<
  TStateAdapter extends StateAdapter<any, any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  TOutcome,
> = TOutcome extends { continueWith: { typeName: infer TContinuationTypeName extends string } }
  ? ContinuedJob<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName,
      TContinuationTypeName
    >
  : TOutcome extends { reschedule: any }
    ? RescheduledJob<
        GetStateAdapterJobId<TStateAdapter>,
        TJobTypeDefinitions,
        TJobTypeName,
        TChainTypeName
      >
    : OutputJob<
        GetStateAdapterJobId<TStateAdapter>,
        TJobTypeDefinitions,
        TJobTypeName,
        TChainTypeName
      >;

/**
 * Commits an outcome inside the caller's transaction. Returns the committed job directly when the
 * state adapter is in sync mode, so it can run inside a synchronous transaction, and a promise
 * otherwise. Takes the transaction context and the
 * `transactionHooks` of that transaction, spread alongside exactly one outcome key — the same
 * convention as `client.createChain`.
 *
 * `withTransactionHooks` must wrap the transaction from outside, so the hooks flush after COMMIT:
 * hooks that flush before COMMIT make the worker treat the attempt as completed even if the
 * transaction then rolls back. On PostgreSQL, Queuert supports only READ COMMITTED (the
 * default).
 *
 * Every write is conditional on this attempt still owning the job; if it does not, nothing is
 * written and `complete` throws, so the caller's transaction rolls back. Validation runs before
 * the first write, so a caught error never leaves a partial write behind.
 *
 * `complete` ends the attempt, not necessarily the job: with `output` the job is completed, with
 * `continueWith` the job is completed and the chain moves on, and with `reschedule` the job goes
 * back to `pending` for a later attempt.
 *
 * `complete` succeeds at most once per `transactionHooks`; a retried transaction needs its own
 * `withTransactionHooks`. A call that threw before writing or was rolled back by
 * `transactionHooks.withSavepoint` does not count. Its events are released through
 * `transactionHooks` once the caller's transaction commits.
 *
 * The return shape is determined by the outcome's discriminant key, never by the user's data.
 *
 * Misuse throws a plain `Error`: a transaction context outside an open transaction, missing
 * `transactionHooks`, not exactly one outcome, a second success or a concurrent call with the
 * same `transactionHooks`, or a call after the handler ended.
 *
 * @throws {@link JobTakenByAnotherWorkerError} if the attempt expired and the job was
 * reclaimed or acquired by another attempt.
 * @throws {@link JobAlreadyCompletedError} if the job was completed elsewhere, for example by
 * `client.completeChain`.
 * @throws {@link JobNotFoundError} if the job was deleted.
 * @throws {@link BlockerLimitExceededError} if a `continueWith` outcome declares more blockers
 * than the per-job limit.
 * @throws {@link ChainNotFoundError} if a `continueWith` blocker chain does not exist.
 * @throws {@link ChainTypeMismatchError} if a `continueWith` blocker's `typeName` differs from the
 * stored chain's.
 */
export type AttemptComplete<
  TStateAdapter extends StateAdapter<any, any, any>,
  in out TJobTypeDefinitions extends BaseJobTypeDefinitions,
  in out TJobTypeName extends string,
  out TChainTypeName extends string,
> = <TOutcome extends AttemptOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>>(
  options: TOutcome & {
    transactionHooks: TransactionHooks;
  } & GetStateAdapterTxContext<TStateAdapter>,
) => StateResult<
  GetStateAdapterMode<TStateAdapter>,
  AttemptCompleteResult<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TChainTypeName, TOutcome>
>;

/**
 * Handler function called for each job attempt.
 *
 * Receives `signal` (aborts when the worker is stopping or the attempt is lost), `job` (the
 * running job with its completed blocker chains) and `complete` (commits the outcome inside the
 * caller's transaction). Do the work, then open a transaction and call `complete` inside it. The
 * handler returns what `complete` returned.
 *
 * A `complete` call counts once its `transactionHooks` flushed — right after COMMIT when
 * `withTransactionHooks` wraps the transaction — and then completes the attempt without another
 * database call, whatever the handler returns. An error the handler throws afterwards does not
 * undo the completion; it is reported as a worker error. Without a counted `complete` — a throw
 * before it, no call, or a call that rolled back — the attempt fails, and the job is rescheduled
 * with backoff.
 */
export type AttemptHandler<
  TStateAdapter extends StateAdapter<any, any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  THandlerCtx,
> = (
  processOptions: {
    signal: AbortSignal;
    job: ResolvedRunningJob<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName
    >;
    complete: AttemptComplete<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TChainTypeName>;
  } & THandlerCtx,
) => Promise<Exclude<AnyJob, { status: "running" }>>;

export type AnyCompleteOptions = BaseTxContext & {
  transactionHooks: TransactionHooks;
  output?: unknown;
  continueWith?: AnyNewJob;
  reschedule?: ScheduleOptions;
};

export type AnyAttemptHandler = (options: {
  signal: AbortSignal;
  job: AnyJob & { blockers: AnyChain[] };
  complete: (
    options: AnyCompleteOptions,
  ) => StateResult<StateAdapterMode, AnyJob & { continuedTo?: AnyJob }>;
}) => Promise<unknown>;
