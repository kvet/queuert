import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import {
  type BlockerChains,
  type ContinuedJob,
  type JobTypeContinuation,
  type JobTypeHasBlockers,
  type JobTypeProperty,
  type ResolvedJobWithBlockers,
  type OutputJob,
} from "../entities/job-types.resolvers.js";
import { type AnyJob, type CompletedJob } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type TypedAbortSignal } from "../helpers/abort.js";
import {
  type BaseTxContext,
  type GetStateAdapterJobId,
  type GetStateAdapterTxContext,
  type StateAdapter,
} from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

/** Reasons a job attempt's signal can be aborted. */
export type JobAbortReason =
  | "taken_by_another_worker"
  | "error"
  | "not_found"
  | "already_completed"
  | "worker_stopping";

type AttemptContinueWithOutcome<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  JobTypeContinuation<TJobTypeDefinitions, TJobTypeName> extends never
    ? never
    : {
        continueWith: {
          [TContinuationTypeName in JobTypeContinuation<TJobTypeDefinitions, TJobTypeName>]: {
            typeName: TContinuationTypeName;
            id?: GetStateAdapterJobId<TStateAdapter>;
            input: JobTypeProperty<TJobTypeDefinitions, TContinuationTypeName, "input">;
            schedule?: ScheduleOptions;
          } & (JobTypeHasBlockers<TJobTypeDefinitions, TContinuationTypeName> extends true
            ? {
                blockers: BlockerChains<
                  GetStateAdapterJobId<TStateAdapter>,
                  TJobTypeDefinitions,
                  TContinuationTypeName
                >;
              }
            : { blockers?: never });
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

/** Every outcome `finish` accepts, as a single union. */
export type AttemptOutcome<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  | AttemptOutputOutcome<TJobTypeDefinitions, TJobTypeName>
  | AttemptContinueWithOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>;

/** Resolves the committed job shape from the outcome's discriminant key.*/
export type AttemptFinishResult<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
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
  : OutputJob<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName
    >;

/**
 * Commits an outcome. The only effectful call inside the complete callback — it
 * writes before it returns, so code running after it, still inside the
 * completion transaction, observes the committed state.
 *
 * The return shape is determined by the outcome's discriminant key, never on
 * the user's data.
 */
export type AttemptFinish<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
> = <TOutcome extends AttemptOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>>(
  outcome: TOutcome,
) => Promise<
  AttemptFinishResult<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TChainTypeName, TOutcome>
>;

/** Options passed to the complete callback: the finish function and the transaction context. */
export type AttemptCompleteOptions<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  TCompleteCtx = Record<string, unknown>,
> = {
  finish: AttemptFinish<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TChainTypeName>;
} & { transactionHooks: TransactionHooks } & GetStateAdapterTxContext<TStateAdapter> &
  TCompleteCtx;

/** Complete callback type. Receives {@link AttemptCompleteOptions} and returns the finish result. */
export type AttemptCompleteCallback<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  TResult,
  TCompleteCtx = Record<string, unknown>,
> = (
  completeOptions: AttemptCompleteOptions<
    TStateAdapter,
    TJobTypeDefinitions,
    TJobTypeName,
    TChainTypeName,
    TCompleteCtx
  >,
) => Promise<TResult>;

/**
 * Typed complete function provided to the
 * {@link AttemptHandler | attemptHandler}. It opens the completion
 * transaction; the outcome is chosen inside by passing exactly one outcome
 * to `finish`.
 *
 * `finish` writes before it returns, so code running after it —
 * still inside the same transaction — observes the committed job.
 */
export type AttemptComplete<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  TCompleteCtx = Record<string, unknown>,
> = <TResult extends CompletedJob<AnyJob>>(
  completeCallback: AttemptCompleteCallback<
    TStateAdapter,
    TJobTypeDefinitions,
    TJobTypeName,
    TChainTypeName,
    TResult,
    TCompleteCtx
  >,
) => Promise<TResult>;

/**
 * Configuration for the prepare phase.
 *
 * - `"atomic"` — prepare and complete run in the same transaction.
 * - `"staged"` — prepare commits first, then complete runs in a new transaction with attempt extension.
 */
export type AttemptPrepareOptions = { mode: "atomic" | "staged" };

/** Callback executed during the prepare phase within the transaction. */
export type AttemptPrepareCallback<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  T,
  TPrepareCtx = Record<string, unknown>,
> = (
  prepareCallbackOptions: GetStateAdapterTxContext<TStateAdapter> & TPrepareCtx,
) => T | Promise<T>;

/**
 * Typed prepare function provided to the
 * {@link AttemptHandler | attemptHandler}. Controls the processing mode and
 * optionally runs a callback within the prepare transaction.
 */
export type AttemptPrepare<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TPrepareCtx = Record<string, unknown>,
> = {
  (config: AttemptPrepareOptions): Promise<void>;
  <T>(
    config: AttemptPrepareOptions,
    prepareCallback: AttemptPrepareCallback<TStateAdapter, T, TPrepareCtx>,
  ): Promise<Awaited<T>>;
};

/**
 * Typed step function provided to the
 * {@link AttemptHandler | attemptHandler}. Opens a fresh guarded transaction
 * mid-attempt — only valid in staged mode between `prepare` and `complete`.
 */
export type AttemptStep<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TStepCtx = Record<string, unknown>,
> = <T>(
  stepCallback: (
    options: { transactionHooks: TransactionHooks } & GetStateAdapterTxContext<TStateAdapter> &
      TStepCtx,
  ) => T | Promise<T>,
) => Promise<Awaited<T>>;

/**
 * Handler function called for each job attempt.
 *
 * Receives `signal` (abort signal), `job` (the running job with blockers), `prepare` (transaction setup), `step` (mid-attempt transactions), and `complete` (the final phase).
 *
 * Processing mode is inferred automatically:
 * - If `complete` is called synchronously (no prior `await`), `prepare` is skipped and the job runs in **atomic** mode (single transaction).
 * - If neither `prepare` nor `complete` is called synchronously, the worker auto-calls `prepare({ mode: "staged" })`.
 */
export type AttemptHandler<
  TStateAdapter extends StateAdapter<BaseTxContext, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  THandlerCtx,
  TPrepareCtx,
  TStepCtx,
  TCompleteCtx,
> = (
  processOptions: {
    signal: TypedAbortSignal<JobAbortReason>;
    job: ResolvedJobWithBlockers<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName
    > & { status: "running" };
    prepare: AttemptPrepare<TStateAdapter, TPrepareCtx>;
    step: AttemptStep<TStateAdapter, TStepCtx>;
    complete: AttemptComplete<
      TStateAdapter,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName,
      TCompleteCtx
    >;
  } & THandlerCtx,
) => Promise<CompletedJob<AnyJob>>;
