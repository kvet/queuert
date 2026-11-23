import type { MaybePromise, ModeResult, Mode } from "@queuert/sync-async";

import type { ModeOf } from "../adapter-mode.ts";
import type { AnyChain } from "../entities/chain.ts";
import type { AnyJob } from "../entities/job.ts";
import type { ScheduleOptions } from "../entities/schedule.ts";
import type { BaseJobTypeDefinitions } from "../job-types/job-type.ts";
import type {
  AnyNewJob,
  ContinuedJob,
  JobTypeContinuation,
  JobTypeProperty,
  NewJob,
  OutputJob,
  RescheduledJob,
  ResolvedRunningJob,
} from "../job-types/job-types.resolvers.ts";
import type {
  StateAdapter,
  BaseTxContext,
  GetStateAdapterJobId,
  GetStateAdapterTxContext,
  GetStateAdapterWorkerId,
} from "../state-adapter/state-adapter.ts";

type JobContinueWithOutcome<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TSliceJobTypeDefinitions extends BaseJobTypeDefinitions,
> = TSliceJobTypeDefinitions extends any
  ? JobTypeContinuation<TSliceJobTypeDefinitions, TJobTypeName> extends never
    ? never
    : {
        continueWith: {
          [
            TContinuationTypeName in JobTypeContinuation<TSliceJobTypeDefinitions, TJobTypeName>
          ]: NewJob<
            GetStateAdapterJobId<TStateAdapter>,
            TSliceJobTypeDefinitions,
            TContinuationTypeName,
            TJobTypeDefinitions
          >;
        }[JobTypeContinuation<TSliceJobTypeDefinitions, TJobTypeName>];
        output?: never;
        reschedule?: never;
        reason?: never;
      }
  : never;

type JobOutputOutcome<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "output"> extends never
    ? never
    : {
        output: JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "output">;
        continueWith?: never;
        reschedule?: never;
        reason?: never;
      };

export type JobRescheduleOutcome = {
  reschedule: ScheduleOptions;
  output?: never;
  continueWith?: never;
  /**
   * Why the job comes back later, stored as the job's `lastRescheduleReason`. Keep it short; longer
   * reasons are truncated to 10,000 characters.
   */
  reason?: string;
};

/**
 * Every outcome an attempt handler's `applyJobOutcome` and `client.applyJobOutcome` accept for a
 * job type, as a single union.
 */
export type JobOutcome<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  | JobOutputOutcome<TJobTypeDefinitions, TJobTypeName>
  | JobContinueWithOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TJobTypeDefinitions>
  | JobRescheduleOutcome;

/** Resolves the committed job shape from the outcome's discriminant key. */
export type JobOutcomeResult<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  TOutcome,
> = TOutcome extends { continueWith: { typeName: infer TContinuationTypeName extends string } }
  ? ContinuedJob<
      GetStateAdapterJobId<TStateAdapter>,
      GetStateAdapterWorkerId<TStateAdapter>,
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
        GetStateAdapterWorkerId<TStateAdapter>,
        TJobTypeDefinitions,
        TJobTypeName,
        TChainTypeName
      >;

/**
 * Commits an outcome inside the caller's transaction. Takes that transaction's context, with every
 * field the state provider's context type requires (`txHooks` included, for a provider that carries
 * them), spread alongside exactly one outcome key — the same convention as `client.createChain`.
 *
 * The attempt counts as completed once the state provider runs the commit callbacks
 * `applyJobOutcome` registered, so the provider must run them only after COMMIT: callbacks that run
 * before COMMIT make the worker treat the attempt as completed even if the transaction then rolls
 * back.
 *
 * The isolation levels the transaction may run at depend on the state adapter. At a level stricter
 * than READ COMMITTED it can fail on a conflict with a concurrent transaction; the caller retries
 * it with fresh `txHooks`, or inside `txHooks.retryBoundary`.
 *
 * Every write is conditional on this attempt still owning the job; if it does not, nothing is
 * written and `applyJobOutcome` throws, so the caller's transaction rolls back. Validation runs
 * before the first write, so a caught error never leaves a partial write behind.
 *
 * `applyJobOutcome` ends the attempt, not necessarily the job: with `output` the job is completed,
 * with `continueWith` the job is completed and the chain moves on, and with `reschedule` the job
 * goes back to `pending` for a later attempt.
 *
 * `applyJobOutcome` succeeds at most once per attempt. A call that threw before writing, or whose
 * transaction or savepoint the state provider reported as rolled back, does not count, so the
 * attempt can call `applyJobOutcome` again in a new transaction. Its events are released through
 * the state provider's `onTransactionCommit` once the caller's transaction commits.
 *
 * The return shape is determined by the outcome's discriminant key, never by the user's data.
 *
 * Misuse throws a plain `Error`, without aborting `job.signal`: a transaction context outside an
 * open transaction, not exactly one outcome, a second success or a concurrent call for the same
 * attempt, or a call after the handler ended.
 *
 * @throws {@link JobTakenByAnotherWorkerError} if the attempt was reclaimed and the job
 * acquired by another attempt.
 * @throws {@link JobAlreadyCompletedError} if the job was completed elsewhere, for example by
 * `client.applyJobOutcome`.
 * @throws {@link JobNotFoundError} if the job was deleted.
 * @throws {@link JobBlockerLimitExceededError} if a `continueWith` outcome declares more blockers
 * than the per-job limit.
 * @throws {@link ChainNotFoundError} if a `continueWith` blocker chain does not exist.
 * @throws {@link ChainTypeMismatchError} if a `continueWith` blocker's `typeName` differs from the
 * stored chain's.
 * @throws {@link JobTypeValidationError} if the job type rejects the `output`, or the continuation
 * job type rejects the `continueWith` target, input or blockers.
 * @throws {@link UnknownJobTypeError} if a merged registry owns no slice for the job type.
 * @throws {@link InvalidJobIdError} if a `continueWith` `id` fails the state adapter's
 * `validateJobId` check.
 */
export type AttemptApplyJobOutcome<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  in out TJobTypeDefinitions extends BaseJobTypeDefinitions,
  in out TJobTypeName extends string,
  out TChainTypeName extends string,
> = <TOutcome extends JobOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>>(
  options: TOutcome & GetStateAdapterTxContext<TStateAdapter>,
) => ModeResult<
  ModeOf<TStateAdapter>,
  NoInfer<
    JobOutcomeResult<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TChainTypeName, TOutcome>
  >
>;

/**
 * Holds the job's attempt inside the caller's transaction until it commits or rolls back. Takes the
 * transaction context of that transaction; unlike `applyJobOutcome`, it registers no commit
 * callbacks, so any part of the context that identifies the transaction is enough.
 *
 * `fenceJob` locks the job row and its chain head and checks that this attempt still owns the job.
 * Reclaiming, completing or deleting the job waits for the caller's transaction to end, so every
 * write in a transaction where `fenceJob` succeeded commits while the attempt owns the job. Use it
 * in the transactions the handler opens besides the one that calls `applyJobOutcome`; keep them
 * short, since the lock holds back everything else that writes to the job or its chain.
 *
 * `fenceJob` writes nothing and can be called any number of times, in the same or different
 * transactions. In the transaction that calls `applyJobOutcome`, call it before `applyJobOutcome`,
 * which ends the attempt, so a later `fenceJob` treats it as lost.
 *
 * Misuse throws a plain `Error`: a transaction context outside an open transaction, or a call
 * after the handler ended.
 *
 * @throws {@link JobTakenByAnotherWorkerError} if the attempt was reclaimed, and aborts
 * `job.signal`.
 * @throws {@link JobAlreadyCompletedError} if the job was completed elsewhere, for example by
 * `client.applyJobOutcome`, and aborts `job.signal`.
 * @throws {@link JobNotFoundError} if the job was deleted, and aborts `job.signal`.
 */
export type AttemptFenceJob<TStateAdapter extends StateAdapter<any, any, any, Mode>> = (
  options: Partial<GetStateAdapterTxContext<TStateAdapter>>,
) => ModeResult<ModeOf<TStateAdapter>, void>;

type AttemptRunningJob<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
> = ResolvedRunningJob<
  GetStateAdapterJobId<TStateAdapter>,
  GetStateAdapterWorkerId<TStateAdapter>,
  TJobTypeDefinitions,
  TJobTypeName,
  TChainTypeName
> & {
  /**
   * Aborts when this job's attempt is lost (reclaimed, completed elsewhere or deleted), or when
   * the worker is stopping or lost its lease.
   */
  signal: AbortSignal;
};

/**
 * Handler function called for each job attempt.
 *
 * Receives `job` (the running job with its completed blocker chains, and `job.signal`, which
 * aborts when the attempt is lost or the worker is stopping or lost its lease), `applyJobOutcome`
 * (commits the outcome inside the caller's transaction) and `fenceJob` (holds the attempt inside
 * another of the caller's transactions until it ends). Do the work, then open a transaction and
 * call `applyJobOutcome` inside it.
 *
 * An `applyJobOutcome` call counts once the state provider runs its commit callbacks — right after
 * COMMIT — and then completes the attempt without another database call. An error the handler
 * throws afterwards does not undo the completion; it is reported as a worker error. Without a
 * counted `applyJobOutcome` when the handler ends — a throw before it, no call, or a call that
 * rolled back — the attempt fails, and the job is rescheduled with backoff. Await the transaction
 * that calls `applyJobOutcome` before the handler returns: a call still running when the handler
 * ends races the failed attempt's reschedule.
 *
 * The handler is asynchronous in both modes. Over a `"sync"` {@link StateAdapter},
 * `applyJobOutcome` and `fenceJob` return their results directly and throw synchronously, so the
 * transaction that calls them can be the driver's own synchronous transaction.
 */
export type AttemptHandler<
  TStateAdapter extends StateAdapter<any, any, any, Mode>,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  THandlerCtx,
> = (
  processOptions: {
    job: AttemptRunningJob<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TChainTypeName>;
    applyJobOutcome: AttemptApplyJobOutcome<
      TStateAdapter,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName
    >;
    fenceJob: AttemptFenceJob<TStateAdapter>;
  } & THandlerCtx,
) => Promise<void>;

export type AnyRunningJob = AnyJob & { blockers: AnyChain[]; signal: AbortSignal };

export type AnyAttemptHandler = (options: {
  job: AnyRunningJob;
  applyJobOutcome: (
    options: AnyJobOutcomeOptions,
  ) => MaybePromise<AnyJob & { continuedTo?: AnyJob }>;
  fenceJob: (options: BaseTxContext) => MaybePromise<void>;
}) => Promise<void>;

export type AnyJobOutcomeOptions = BaseTxContext & AnyJobOutcomeFields;

export type AnyJobOutcomeFields = {
  output?: unknown;
  continueWith?: AnyNewJob;
  reschedule?: ScheduleOptions;
  reason?: string;
};

export type AnyJobOutcome =
  | { output: unknown }
  | { continueWith: AnyNewJob }
  | { reschedule: ScheduleOptions; reason?: string };
