import type { AdapterModeOf, ModeResult } from "../adapter-mode.ts";
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
  AnyStateAdapter,
  BaseTxContext,
  GetStateAdapterJobId,
  GetStateAdapterTxContext,
  GetStateAdapterWorkerId,
} from "../state-adapter/state-adapter.ts";

type AttemptContinueWithOutcome<
  TStateAdapter extends AnyStateAdapter,
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
  TStateAdapter extends AnyStateAdapter,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  | AttemptOutputOutcome<TJobTypeDefinitions, TJobTypeName>
  | AttemptContinueWithOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>
  | AttemptRescheduleOutcome;

/** Resolves the committed job shape from the outcome's discriminant key. */
export type AttemptCompleteResult<
  TStateAdapter extends AnyStateAdapter,
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
 * The attempt counts as completed once the state provider runs the commit callbacks `complete`
 * registered, so the provider must run them only after COMMIT: callbacks that run before COMMIT
 * make the worker treat the attempt as completed even if the transaction then rolls back. On
 * PostgreSQL, Queuert supports only READ COMMITTED (the default).
 *
 * Every write is conditional on this attempt still owning the job; if it does not, nothing is
 * written and `complete` throws, so the caller's transaction rolls back. Validation runs before
 * the first write, so a caught error never leaves a partial write behind.
 *
 * `complete` ends the attempt, not necessarily the job: with `output` the job is completed, with
 * `continueWith` the job is completed and the chain moves on, and with `reschedule` the job goes
 * back to `pending` for a later attempt.
 *
 * `complete` succeeds at most once per attempt. A call that threw before writing, or whose
 * transaction or savepoint the state provider reported as rolled back, does not count, so the
 * attempt can call `complete` again in a new transaction. Its events are released through the
 * state provider's `onTransactionCommit` once the caller's transaction commits.
 *
 * The return shape is determined by the outcome's discriminant key, never by the user's data.
 *
 * Misuse throws a plain `Error`, without aborting `signal`: a transaction context outside an open
 * transaction, not exactly one outcome, a second success or a concurrent call for the same attempt,
 * or a call after the handler ended.
 *
 * @throws {@link JobTakenByAnotherWorkerError} if the attempt was reclaimed and the job
 * acquired by another attempt.
 * @throws {@link JobAlreadyCompletedError} if the job was completed elsewhere, for example by
 * `client.completeChain`.
 * @throws {@link JobNotFoundError} if the job was deleted.
 * @throws {@link BlockerLimitExceededError} if a `continueWith` outcome declares more blockers
 * than the per-job limit.
 * @throws {@link ChainNotFoundError} if a `continueWith` blocker chain does not exist.
 * @throws {@link ChainTypeMismatchError} if a `continueWith` blocker's `typeName` differs from the
 * stored chain's.
 * @throws {@link JobTypeValidationError} if the job type rejects the `output`, or the continuation
 * job type rejects the `continueWith` target, input or blockers.
 * @throws {@link InvalidJobIdError} if a `continueWith` `id` fails the state adapter's
 * `validateJobId` check.
 */
export type AttemptComplete<
  TStateAdapter extends AnyStateAdapter,
  in out TJobTypeDefinitions extends BaseJobTypeDefinitions,
  in out TJobTypeName extends string,
  out TChainTypeName extends string,
> = <TOutcome extends AttemptOutcome<TStateAdapter, TJobTypeDefinitions, TJobTypeName>>(
  options: TOutcome & GetStateAdapterTxContext<TStateAdapter>,
) => ModeResult<
  AdapterModeOf<TStateAdapter>,
  AttemptCompleteResult<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TChainTypeName, TOutcome>
>;

/**
 * Holds the attempt's ownership of the job inside the caller's transaction until it commits or
 * rolls back. Takes the transaction context of that transaction; unlike `complete`, it registers no
 * commit callbacks, so any part of the context that identifies the transaction is enough.
 *
 * `fence` locks the job row and its chain head and checks that this attempt still owns the job.
 * Reclaiming, completing or deleting the job waits for the caller's transaction to end, so every
 * write in a transaction where `fence` succeeded commits while the attempt owns the job. Use it in
 * the transactions the handler opens besides the one that calls `complete`; keep them short,
 * since the lock holds back everything else that writes to the job or its chain.
 *
 * `fence` writes nothing and can be called any number of times, in the same or different
 * transactions. In the transaction that calls `complete`, call it before `complete`: `complete`
 * ends the attempt, so a later `fence` treats it as lost.
 *
 * Misuse throws a plain `Error`: a transaction context outside an open transaction, or a call
 * after the handler ended.
 *
 * @throws {@link JobTakenByAnotherWorkerError} if the attempt was reclaimed, and aborts `signal`.
 * @throws {@link JobAlreadyCompletedError} if the job was completed elsewhere, for example by
 * `client.completeChain`, and aborts `signal`.
 * @throws {@link JobNotFoundError} if the job was deleted, and aborts `signal`.
 */
export type AttemptFence<TStateAdapter extends AnyStateAdapter> = (
  options: Partial<GetStateAdapterTxContext<TStateAdapter>>,
) => ModeResult<AdapterModeOf<TStateAdapter>, void>;

/**
 * Handler function called for each job attempt.
 *
 * Receives `signal` (aborts when the worker is stopping or lost its lease, or the attempt is
 * lost), `job` (the running job with its completed blocker chains), `complete` (commits the
 * outcome inside the caller's transaction) and `fence` (holds the attempt's ownership inside
 * another of the caller's transactions until it ends). Do the work, then open a transaction and
 * call `complete` inside it. The handler returns what `complete` returned.
 *
 * A `complete` call counts once the state provider runs its commit callbacks — right after
 * COMMIT — and then completes the attempt without another database call, whatever the handler
 * returns. An error the handler throws afterwards does not
 * undo the completion; it is reported as a worker error. Without a counted `complete` — a throw
 * before it, no call, or a call that rolled back — the attempt fails, and the job is rescheduled
 * with backoff.
 *
 * The handler is asynchronous in both modes. Over a {@link SyncStateAdapter}, `complete` and
 * `fence` return their results directly and throw synchronously, so the transaction that calls
 * them can be the driver's own synchronous transaction.
 */
export type AttemptHandler<
  TStateAdapter extends AnyStateAdapter,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
  THandlerCtx,
> = (
  processOptions: {
    signal: AbortSignal;
    job: ResolvedRunningJob<
      GetStateAdapterJobId<TStateAdapter>,
      GetStateAdapterWorkerId<TStateAdapter>,
      TJobTypeDefinitions,
      TJobTypeName,
      TChainTypeName
    >;
    complete: AttemptComplete<TStateAdapter, TJobTypeDefinitions, TJobTypeName, TChainTypeName>;
    fence: AttemptFence<TStateAdapter>;
  } & THandlerCtx,
) => Promise<Exclude<AnyJob, { status: "running" }>>;

export type AnyCompleteOptions = BaseTxContext & {
  output?: unknown;
  continueWith?: AnyNewJob;
  reschedule?: ScheduleOptions;
};
