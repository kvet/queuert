import { RetryConfig, withRetry } from "../helpers/retry.js";
import { BaseStateProviderContext, StateProvider } from "../state-provider/state-provider.js";
import { isTransientPgError } from "./errors.js";
import {
  acquireJobSql,
  addJobBlockersSql,
  completeJobSql,
  createJobSql,
  DbJob,
  getJobBlockersSql,
  getJobByIdSql,
  getJobSequenceByIdSql,
  getNextJobAvailableInMsSql,
  markJobAsBlockedSql,
  markJobAsPendingSql,
  migrateSql,
  removeExpiredJobLeaseSql,
  renewJobLeaseSql,
  rescheduleJobSql,
  scheduleBlockedJobsSql,
  setupSql,
  startJobAttemptSql,
} from "./sql.js";
import { StateAdapter, StateJob } from "./state-adapter.js";

export type NamedParameter<TParamName extends string, TParamValue> = TParamValue & {
  /* @deprecated - type-only */
  $paramName?: TParamName;
};

export type TypedSql<
  TParams extends
    | readonly [NamedParameter<string, unknown>, ...NamedParameter<string, unknown>[]]
    | readonly [],
  TResult,
> = string & {
  /* @deprecated - type-only */
  $paramsType?: TParams;
  /* @deprecated - type-only */
  $resultType?: TResult;
};

const mapDbJobToStateJob = (dbJob: DbJob): StateJob => {
  return {
    id: dbJob.id,
    typeName: dbJob.type_name,
    input: dbJob.input,
    output: dbJob.output,

    rootId: dbJob.root_id,
    sequenceId: dbJob.sequence_id,
    originId: dbJob.origin_id,

    status: dbJob.status,
    createdAt: new Date(dbJob.created_at),
    scheduledAt: new Date(dbJob.scheduled_at),
    completedAt: dbJob.completed_at ? new Date(dbJob.completed_at) : null,

    attempt: dbJob.attempt,
    lastAttemptError: dbJob.last_attempt_error,
    lastAttemptAt: dbJob.last_attempt_at ? new Date(dbJob.last_attempt_at) : null,

    leasedBy: dbJob.leased_by,
    leasedUntil: dbJob.leased_until ? new Date(dbJob.leased_until) : null,

    deduplicationKey: dbJob.deduplication_key,

    updatedAt: new Date(dbJob.updated_at),
  };
};

export const createPgStateAdapter = <TContext extends BaseStateProviderContext>({
  stateProvider,
  connectionRetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    multiplier: 5.0,
    maxDelayMs: 10 * 1000,
  },
  isTransientError = isTransientPgError,
}: {
  stateProvider: StateProvider<TContext>;
  connectionRetryConfig?: RetryConfig;
  isTransientError?: (error: unknown) => boolean;
}): StateAdapter<TContext> => {
  const executeTypedSql = async <
    TParams extends
      | readonly [NamedParameter<string, unknown>, ...NamedParameter<string, unknown>[]]
      | readonly [],
    TResult,
  >({
    context,
    sql,
    params,
  }: {
    context: TContext;
    sql: TypedSql<TParams, TResult>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: TParams })): Promise<TResult> =>
    withRetry(
      () => stateProvider.executeSql<TResult>(context, sql, params as any),
      connectionRetryConfig,
      { isRetryableError: isTransientError },
    );

  return {
    provideContext: (fn) => stateProvider.provideContext(fn),
    runInTransaction: (context, fn) => stateProvider.runInTransaction(context, fn),
    assertInTransaction: (context) => stateProvider.assertInTransaction(context),

    prepareSchema: async (context) => {
      await executeTypedSql({
        context,
        sql: setupSql,
      });
    },
    migrateToLatest: async (context) => {
      await executeTypedSql({
        context,
        sql: migrateSql,
      });
    },

    getJobSequenceById: async ({ context, jobId }) => {
      const [jobSequence] = await executeTypedSql({
        context,
        sql: getJobSequenceByIdSql,
        params: [jobId],
      });

      return jobSequence
        ? [
            mapDbJobToStateJob(jobSequence.root_job),
            jobSequence.last_sequence_job
              ? mapDbJobToStateJob(jobSequence.last_sequence_job)
              : undefined,
          ]
        : undefined;
    },
    getJobById: async ({ context, jobId }) => {
      const [job] = await executeTypedSql({
        context,
        sql: getJobByIdSql,
        params: [jobId],
      });

      return job ? mapDbJobToStateJob(job) : undefined;
    },

    createJob: async ({
      context,
      typeName,
      input,
      rootId,
      sequenceId,
      originId,
      deduplication,
    }) => {
      const [result] = await executeTypedSql({
        context,
        sql: createJobSql,
        params: [
          typeName,
          input as any,
          rootId as any,
          sequenceId as any,
          originId as any,
          (deduplication?.key ?? null) as any,
          (deduplication ? (deduplication.strategy ?? "finalized") : null) as any,
          (deduplication?.windowMs ?? null) as any,
        ],
      });

      return { job: mapDbJobToStateJob(result), deduplicated: result.deduplicated };
    },

    addJobBlockers: async ({ context, jobId, blockedBySequenceIds }) => {
      const jobs = await executeTypedSql({
        context,
        sql: addJobBlockersSql,
        params: [
          Array.from({ length: blockedBySequenceIds.length }, () => jobId),
          blockedBySequenceIds,
        ],
      });

      return jobs.map(mapDbJobToStateJob).map((job) => [job, undefined]);
    },
    scheduleBlockedJobs: async ({ context, blockedBySequenceId }) => {
      const jobs = await executeTypedSql({
        context,
        sql: scheduleBlockedJobsSql,
        params: [blockedBySequenceId],
      });
      return jobs.map(mapDbJobToStateJob);
    },
    getJobBlockers: async ({ context, jobId }) => {
      const jobSequences = await executeTypedSql({
        context,
        sql: getJobBlockersSql,
        params: [jobId],
      });

      return jobSequences.map(({ root_job, last_sequence_job }) => [
        mapDbJobToStateJob(root_job),
        last_sequence_job ? mapDbJobToStateJob(last_sequence_job) : undefined,
      ]);
    },

    getNextJobAvailableInMs: async ({ context, typeNames }) => {
      const [result] = await executeTypedSql({
        context,
        sql: getNextJobAvailableInMsSql,
        params: [typeNames],
      });
      return result ? result.available_in_ms : null;
    },
    acquireJob: async ({ context, typeNames }) => {
      const [job] = await executeTypedSql({ context, sql: acquireJobSql, params: [typeNames] });

      return job ? mapDbJobToStateJob(job) : undefined;
    },
    markJobAsBlocked: async ({ context, jobId }) => {
      const [job] = await executeTypedSql({ context, sql: markJobAsBlockedSql, params: [jobId] });

      return mapDbJobToStateJob(job);
    },
    markJobAsPending: async ({ context, jobId }) => {
      const [job] = await executeTypedSql({ context, sql: markJobAsPendingSql, params: [jobId] });

      return mapDbJobToStateJob(job);
    },
    startJobAttempt: async ({ context, jobId }) => {
      const [job] = await executeTypedSql({ context, sql: startJobAttemptSql, params: [jobId] });

      return mapDbJobToStateJob(job);
    },
    renewJobLease: async ({ context, jobId, workerId, leaseDurationMs }) => {
      const [job] = await executeTypedSql({
        context,
        sql: renewJobLeaseSql,
        params: [jobId, workerId, leaseDurationMs],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ context, jobId, afterMs, error }) => {
      const [job] = await executeTypedSql({
        context,
        sql: rescheduleJobSql,
        params: [jobId, afterMs, JSON.stringify(error)],
      });

      return mapDbJobToStateJob(job);
    },
    completeJob: async ({ context, jobId, output }) => {
      const [job] = await executeTypedSql({
        context,
        sql: completeJobSql,
        params: [jobId, output as any],
      });

      return mapDbJobToStateJob(job);
    },
    removeExpiredJobLease: async ({ context, typeNames }) => {
      const [job] = await executeTypedSql({
        context,
        sql: removeExpiredJobLeaseSql,
        params: [typeNames],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
  };
};
