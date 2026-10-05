import { type BaseJobTypeDefinitions } from "../entities/job-type.js";
import {
  type BlockerChains,
  type CompletedBlockerChains,
  type ContinuedJob,
  type JobTypeContinuation,
  type JobTypeHasBlockers,
  type JobTypeProperty,
  type OutputJob,
  type RescheduledJob,
  type ResolvedRunningJob,
} from "../entities/job-types.resolvers.js";
import { type AnyJob } from "../entities/job.js";
import { type ScheduleOptions } from "../entities/schedule.js";
import { type TypedAbortSignal } from "../helpers/abort.js";
import {
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

type AttemptRescheduleOutcome = { reschedule: ScheduleOptions };

/** Every outcome `finish` accepts, as a single union. */
export type AttemptOutcome<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  | AttemptOutputOutcome<TJobTypeDefinitions, TJobTypeName>
  | AttemptContinueWithOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>
  | AttemptRescheduleOutcome;

/** Resolves the committed job shape from the outcome's discriminant key.*/
export type AttemptFinishResult<
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
 * written and `finish` throws `JobTakenByAnotherWorkerError`, `JobAlreadyCompletedError` or
 * `JobNotFoundError`, so the caller's transaction rolls back. Under REPEATABLE READ or
 * SERIALIZABLE a concurrent write to the job row surfaces as a serialization error instead. Validation runs before the first write, so a caught error never leaves a partial
 * write behind.
 *
 * `finish` may be called again in a retried transaction; the last call wins. Its events are
 * released through `transactionHooks` once the caller's transaction commits.
 *
 * The return shape is determined by the outcome's discriminant key, never on the user's data.
 */
// The variance annotations restate what TypeScript measures for these parameters
// and spare it that measurement (~1k instantiations per program). `TStateAdapter`
// measures as bivariant, which no annotation can express, so it stays unannotated.
export type AttemptFinish<
  TStateAdapter extends StateAdapter<any, any>,
  in out TJobTypeDefinitions extends BaseJobTypeDefinitions,
  in out TJobTypeName extends string,
  out TChainTypeName extends string,
> = <TOutcome extends AttemptOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>>(
  options: TOutcome & {
    transactionHooks: TransactionHooks;
  } & GetStateAdapterTxContext<TStateAdapter>,
) => Promise<
  AttemptFinishResult<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TChainTypeName, TOutcome>
>;

/**
 * Reads the job's blocker chains, all completed, in declaration order. Pass a transaction
 * context to read inside that transaction; without one the read runs on its own connection.
 * Only present for job types that declare blockers.
 */
export type AttemptGetBlockers<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> = (
  txCtx?: Partial<GetStateAdapterTxContext<TStateAdapter>>,
) => Promise<
  CompletedBlockerChains<GetStateAdapterJobId<TStateAdapter>, TJobTypeDefinitions, TJobTypeName>
>;

/**
 * Handler function called for each job attempt.
 *
 * Receives `signal` (abort signal), `job` (the running job), `finish` (commits the outcome
 * inside the caller's transaction) and, for job types with blockers, `getBlockers`. Queuert
 * opens no transaction around the handler: do the work, then open a transaction and call
 * `finish` inside it. The handler must return what `finish` returned.
 *
 * After the handler ends, the worker checks the database: if no `finish` committed, the
 * attempt counts as failed and the job is rescheduled with backoff.
 */
export type AttemptHandler<
  TStateAdapter extends StateAdapter<any, any>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  THandlerCtx,
> = (
  processOptions: {
    signal: TypedAbortSignal<JobAbortReason>;
    job: ResolvedRunningJob<
      GetStateAdapterJobId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName
    >;
    finish: AttemptFinish<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TChainTypeName>;
  } & (JobTypeHasBlockers<TJobTypeDefinitions, TJobTypeName> extends true
    ? { getBlockers: AttemptGetBlockers<TStateAdapter, TJobTypeDefinitions, TJobTypeName> }
    : { getBlockers?: never }) &
    THandlerCtx,
) => Promise<Exclude<AnyJob, { status: "running" }>>;
