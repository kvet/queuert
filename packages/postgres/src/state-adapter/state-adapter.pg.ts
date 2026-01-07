import {
  type BaseStateAdapterContext,
  type RetryConfig,
  type StateAdapter,
  type StateJob,
} from "queuert";
import { withRetry } from "queuert/internal";
import {
  createTemplateApplier,
  type NamedParameter,
  type TypedSql,
  type UnwrapNamedParameters,
} from "@queuert/typed-sql";
import { UUID } from "crypto";
import { PgStateProvider } from "../state-provider/state-provider.pg.js";
import { isTransientPgError } from "./errors.js";
import {
  acquireJobSql,
  addJobBlockersSql,
  completeJobSql,
  createJobSql,
  type DbJob,
  deleteJobsByRootIdsSql,
  getCurrentJobForUpdateSql,
  getExternalBlockersSql,
  getJobBlockersSql,
  getJobByIdSql,
  getJobForUpdateSql,
  getJobSequenceByIdSql,
  getNextJobAvailableInMsSql,
  migrateSql,
  removeExpiredJobLeaseSql,
  renewJobLeaseSql,
  rescheduleJobSql,
  scheduleBlockedJobsSql,
} from "./sql.js";

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
    completedBy: dbJob.completed_by,

    attempt: dbJob.attempt,
    lastAttemptError: dbJob.last_attempt_error,
    lastAttemptAt: dbJob.last_attempt_at ? new Date(dbJob.last_attempt_at) : null,

    leasedBy: dbJob.leased_by,
    leasedUntil: dbJob.leased_until ? new Date(dbJob.leased_until) : null,

    deduplicationKey: dbJob.deduplication_key,

    updatedAt: new Date(dbJob.updated_at),
  };
};

export const createPgStateAdapter = <
  TContext extends BaseStateAdapterContext,
  TIdType extends string = UUID,
>({
  stateProvider,
  connectionRetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    multiplier: 5.0,
    maxDelayMs: 10 * 1000,
  },
  isTransientError = isTransientPgError,
  schema = "queuert",
  idType = "uuid",
  idDefault = "gen_random_uuid()",
}: {
  stateProvider: PgStateProvider<TContext>;
  connectionRetryConfig?: RetryConfig;
  isTransientError?: (error: unknown) => boolean;
  schema?: string;
  idType?: string;
  idDefault?: string;
  /** @deprecated used for type inference only */
  $idType?: TIdType;
}): StateAdapter<TContext, TIdType> & {
  migrateToLatest: (context: TContext) => Promise<void>;
} => {
  const applyTemplate = createTemplateApplier({ schema, id_type: idType, id_default: idDefault });

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
    : { params: UnwrapNamedParameters<TParams> })): Promise<TResult> => {
    const resolvedSql = applyTemplate(sql);
    return withRetry(
      async () => stateProvider.executeSql(context, resolvedSql.sql, params) as Promise<TResult>,
      connectionRetryConfig,
      { isRetryableError: isTransientError },
    );
  };

  return {
    provideContext: async (fn) => stateProvider.provideContext(fn) as ReturnType<typeof fn>,
    runInTransaction: async (context, fn) =>
      stateProvider.runInTransaction(context, fn) as ReturnType<typeof fn>,
    isInTransaction: async (context) => stateProvider.isInTransaction(context),

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
      schedule,
    }) => {
      const [result] = await executeTypedSql({
        context,
        sql: createJobSql,
        params: [
          typeName,
          input,
          rootId,
          sequenceId,
          originId,
          deduplication?.key ?? null,
          deduplication ? (deduplication.strategy ?? "completed") : null,
          deduplication?.windowMs ?? null,
          schedule?.at ?? null,
          schedule?.afterMs ?? null,
        ],
      });

      return { job: mapDbJobToStateJob(result), deduplicated: result.deduplicated };
    },

    addJobBlockers: async ({ context, jobId, blockedBySequenceIds }) => {
      const [job] = await executeTypedSql({
        context,
        sql: addJobBlockersSql,
        params: [
          Array.from({ length: blockedBySequenceIds.length }, () => jobId),
          blockedBySequenceIds,
        ],
      });

      return mapDbJobToStateJob(job);
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
    renewJobLease: async ({ context, jobId, workerId, leaseDurationMs }) => {
      const [job] = await executeTypedSql({
        context,
        sql: renewJobLeaseSql,
        params: [jobId, workerId, leaseDurationMs],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ context, jobId, schedule, error }) => {
      const [job] = await executeTypedSql({
        context,
        sql: rescheduleJobSql,
        params: [jobId, schedule.at ?? null, schedule.afterMs ?? null, JSON.stringify(error)],
      });

      return mapDbJobToStateJob(job);
    },
    completeJob: async ({ context, jobId, output, workerId }) => {
      const [job] = await executeTypedSql({
        context,
        sql: completeJobSql,
        params: [jobId, output, workerId],
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
    getExternalBlockers: async ({ context, rootIds }) => {
      const blockers = await executeTypedSql({
        context,
        sql: getExternalBlockersSql,
        params: [rootIds],
      });
      return blockers.map((b) => ({
        jobId: b.job_id as TIdType,
        blockedRootId: b.blocked_root_id as TIdType,
      }));
    },
    deleteJobsByRootIds: async ({ context, rootIds }) => {
      const jobs = await executeTypedSql({
        context,
        sql: deleteJobsByRootIdsSql,
        params: [rootIds],
      });
      return jobs.map(mapDbJobToStateJob);
    },
    getJobForUpdate: async ({ context, jobId }) => {
      const [job] = await executeTypedSql({
        context,
        sql: getJobForUpdateSql,
        params: [jobId],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
    getCurrentJobForUpdate: async ({ context, sequenceId }) => {
      const [job] = await executeTypedSql({
        context,
        sql: getCurrentJobForUpdateSql,
        params: [sequenceId],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
  };
};

export type PgStateAdapter<TContext extends BaseStateAdapterContext, TJobId> = StateAdapter<
  TContext,
  TJobId
>;
