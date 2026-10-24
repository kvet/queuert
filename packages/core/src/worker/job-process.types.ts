import { type AnyJob } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type BaseJobTypeDefinitions } from "../job-types/job-type.js";
import {
  type BlockerChainsInput,
  type ContinuedJob,
  type JobTypeContinuation,
  type JobTypeHasBlockers,
  type JobTypeProperty,
  type OutputJob,
  type RescheduledJob,
  type ResolvedRunningJob,
} from "../job-types/job-types.resolvers.js";
import {
  type GetStateAdapterJobId,
  type GetStateAdapterTxContext,
  type StateAdapter,
} from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

type AttemptContinueWithOutcome<
  TStateAdapter extends StateAdapter<any, any>,
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
                blockers: BlockerChainsInput<
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

type AttemptRescheduleOutcome = { reschedule: ScheduleOptions };

/** Every outcome `complete` accepts, as a single union. */
export type AttemptOutcome<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  | AttemptOutputOutcome<TJobTypeDefinitions, TJobTypeName>
  | AttemptContinueWithOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>
  | AttemptRescheduleOutcome;

/** Resolves the committed job shape from the outcome's discriminant key.*/
export type AttemptCompleteResult<
  TStateAdapter extends StateAdapter<any, any>,
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
 * Commits an outcome inside the caller's transaction. Takes the transaction context and the
 * `transactionHooks` of that transaction, spread alongside exactly one outcome key — the same
 * convention as `client.createChain`.
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
 * The return shape is determined by the outcome's discriminant key, never on the user's data.
 *
 * @throws {@link JobTakenByAnotherWorkerError} if the attempt expired and the job was
 * reclaimed or acquired by another attempt.
 * @throws {@link JobAlreadyCompletedError} if the job was completed elsewhere, for example by
 * `client.completeChain`.
 * @throws {@link JobNotFoundError} if the job was deleted.
 * @throws {@link ChainNotFoundError} if a `continueWith` blocker chain does not exist.
 */
export type AttemptComplete<
  TStateAdapter extends StateAdapter<any, any>,
  in out TJobTypeDefinitions extends BaseJobTypeDefinitions,
  in out TJobTypeName extends string,
  out TChainTypeName extends string,
> = <TOutcome extends AttemptOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>>(
  options: TOutcome & {
    transactionHooks: TransactionHooks;
  } & GetStateAdapterTxContext<TStateAdapter>,
) => Promise<
  AttemptCompleteResult<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TChainTypeName, TOutcome>
>;

/**
 * Handler function called for each job attempt.
 *
 * Receives `signal` (aborts when the worker is stopping or the attempt is lost), `job` (the
 * running job with its completed blocker chains) and `complete` (commits the outcome inside the
 * caller's transaction). Do the work, then open a transaction and call `complete` inside it. The handler must return what
 * `complete` returned.
 *
 * A returned `complete` result whose transaction committed completes the attempt without another
 * database call. Anything else — a throw before `complete` committed, no `complete`, or a `complete`
 * that rolled back — counts as a failed attempt, and the job is rescheduled with backoff.
 */
export type AttemptHandler<
  TStateAdapter extends StateAdapter<any, any>,
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
