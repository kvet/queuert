import {
  BaseStateAdapterContext,
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
import { SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";
import { isTransientSqliteError } from "./errors.js";
import {
  acquireJobSql,
  checkBlockersStatusSql,
  completeJobSql,
  type DbJob,
  type DbJobSequenceRow,
  deleteJobsByRootIdsSql,
  findExistingJobSql,
  findReadyJobsSql,
  getCurrentJobForUpdateSql,
  getExternalBlockersSql,
  getJobBlockersSql,
  getJobByIdForBlockersSql,
  getJobByIdSql,
  getJobForUpdateSql,
  getJobSequenceByIdSql,
  getNextJobAvailableInMsSql,
  insertJobBlockerSql,
  insertJobSql,
  jobColumnsPrefixedSelect,
  jobColumnsSelect,
  migrateSql,
  removeExpiredJobLeaseSql,
  renewJobLeaseSql,
  rescheduleJobSql,
  scheduleBlockedJobSql,
  updateJobToBlockedSql,
} from "./sql.js";

const parseJson = (value: string | null): unknown => {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const mapDbJobToStateJob = (dbJob: DbJob): StateJob => {
  return {
    id: dbJob.id,
    typeName: dbJob.type_name,
    input: parseJson(dbJob.input),
    output: parseJson(dbJob.output),

    rootId: dbJob.root_id,
    sequenceId: dbJob.sequence_id,
    originId: dbJob.origin_id,

    status: dbJob.status,
    createdAt: new Date(dbJob.created_at + "Z"),
    scheduledAt: new Date(dbJob.scheduled_at + "Z"),
    completedAt: dbJob.completed_at ? new Date(dbJob.completed_at + "Z") : null,
    completedBy: dbJob.completed_by,

    attempt: dbJob.attempt,
    lastAttemptError: parseJson(dbJob.last_attempt_error) as string | null,
    lastAttemptAt: dbJob.last_attempt_at ? new Date(dbJob.last_attempt_at + "Z") : null,

    leasedBy: dbJob.leased_by,
    leasedUntil: dbJob.leased_until ? new Date(dbJob.leased_until + "Z") : null,

    deduplicationKey: dbJob.deduplication_key,

    updatedAt: new Date(dbJob.updated_at + "Z"),
  };
};

const parseDbJobSequenceRow = (
  row: DbJobSequenceRow,
): { rootJob: DbJob; lastSequenceJob: DbJob | null } => {
  const rootJob: DbJob = {
    id: row.id,
    type_name: row.type_name,
    input: row.input,
    output: row.output,
    root_id: row.root_id,
    sequence_id: row.sequence_id,
    origin_id: row.origin_id,
    status: row.status,
    created_at: row.created_at,
    scheduled_at: row.scheduled_at,
    completed_at: row.completed_at,
    completed_by: row.completed_by,
    attempt: row.attempt,
    last_attempt_at: row.last_attempt_at,
    last_attempt_error: row.last_attempt_error,
    leased_by: row.leased_by,
    leased_until: row.leased_until,
    deduplication_key: row.deduplication_key,
    updated_at: row.updated_at,
  };

  const lastSequenceJob: DbJob | null = row.lc_id
    ? {
        id: row.lc_id,
        type_name: row.lc_type_name!,
        input: row.lc_input,
        output: row.lc_output,
        root_id: row.lc_root_id!,
        sequence_id: row.lc_sequence_id!,
        origin_id: row.lc_origin_id,
        status: row.lc_status!,
        created_at: row.lc_created_at!,
        scheduled_at: row.lc_scheduled_at!,
        completed_at: row.lc_completed_at,
        completed_by: row.lc_completed_by,
        attempt: row.lc_attempt!,
        last_attempt_at: row.lc_last_attempt_at,
        last_attempt_error: row.lc_last_attempt_error,
        leased_by: row.lc_leased_by,
        leased_until: row.lc_leased_until,
        deduplication_key: row.lc_deduplication_key,
        updated_at: row.lc_updated_at!,
      }
    : null;

  return { rootJob, lastSequenceJob };
};

export const createSqliteStateAdapter = <
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
  isTransientError = isTransientSqliteError,
  tablePrefix = "queuert_",
  idType = "TEXT",
  idGenerator = () => crypto.randomUUID() as TIdType,
}: {
  stateProvider: SqliteStateProvider<TContext>;
  connectionRetryConfig?: RetryConfig;
  isTransientError?: (error: unknown) => boolean;
  tablePrefix?: string;
  idType?: string;
  idGenerator?: () => TIdType;
}): StateAdapter<TContext, TIdType> & {
  migrateToLatest: (context: TContext) => Promise<void>;
} => {
  const applyTemplate = createTemplateApplier(
    { table_prefix: tablePrefix, id_type: idType },
    {
      job_columns: jobColumnsSelect,
      job_columns_prefixed: jobColumnsPrefixedSelect,
    },
  );

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
      async () =>
        stateProvider.executeSql(
          context,
          resolvedSql.sql,
          params,
          resolvedSql.returns,
        ) as Promise<TResult>,
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
      const db = (context as unknown as { db: { exec: (sqlStr: string) => void } }).db;
      db.exec(applyTemplate(migrateSql).sql);
    },

    getJobSequenceById: async ({ context, jobId }) => {
      const [row] = await executeTypedSql({
        context,
        sql: getJobSequenceByIdSql,
        params: [jobId, jobId],
      });

      if (!row) return undefined;

      const { rootJob, lastSequenceJob } = parseDbJobSequenceRow(row);

      return [
        mapDbJobToStateJob(rootJob),
        lastSequenceJob && lastSequenceJob.id !== rootJob.id
          ? mapDbJobToStateJob(lastSequenceJob)
          : undefined,
      ];
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
      const newId = idGenerator();
      const inputJson = input !== undefined ? JSON.stringify(input) : null;
      const deduplicationKey = deduplication?.key ?? null;
      const deduplicationStrategy = deduplication ? (deduplication.strategy ?? "completed") : null;
      const deduplicationWindowMs = deduplication?.windowMs ?? null;

      const sequenceIdOrNull = sequenceId ?? null;
      const originIdOrNull = originId ?? null;
      const rootIdOrNull = rootId ?? null;
      const scheduledAtIso = schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null;
      const scheduleAfterMsOrNull = schedule?.afterMs ?? null;

      const [existing] = await executeTypedSql({
        context,
        sql: findExistingJobSql,
        params: [
          sequenceIdOrNull,
          originIdOrNull,
          sequenceIdOrNull,
          originIdOrNull,
          deduplicationKey,
          deduplicationKey,
          deduplicationStrategy,
          deduplicationStrategy,
          deduplicationStrategy,
          deduplicationWindowMs,
          deduplicationWindowMs,
        ],
      });

      if (existing) {
        return { job: mapDbJobToStateJob(existing), deduplicated: true };
      }

      const [result] = await executeTypedSql({
        context,
        sql: insertJobSql,
        params: [
          newId,
          typeName,
          inputJson,
          rootIdOrNull,
          newId,
          sequenceIdOrNull,
          newId,
          originIdOrNull,
          deduplicationKey,
          scheduledAtIso,
          scheduleAfterMsOrNull,
          scheduleAfterMsOrNull,
        ],
      });

      return { job: mapDbJobToStateJob(result), deduplicated: false };
    },

    addJobBlockers: async ({ context, jobId, blockedBySequenceIds }) => {
      for (let i = 0; i < blockedBySequenceIds.length; i++) {
        await executeTypedSql({
          context,
          sql: insertJobBlockerSql,
          params: [jobId, blockedBySequenceIds[i], i],
        });
      }

      const blockerStatuses = await executeTypedSql({
        context,
        sql: checkBlockersStatusSql,
        params: [jobId],
      });

      const hasIncompleteBlockers = blockerStatuses.some((b) => b.blocker_status !== "completed");

      if (hasIncompleteBlockers) {
        const [updatedJob] = await executeTypedSql({
          context,
          sql: updateJobToBlockedSql,
          params: [jobId],
        });
        if (updatedJob) {
          return mapDbJobToStateJob(updatedJob);
        }
      }

      const [job] = await executeTypedSql({
        context,
        sql: getJobByIdForBlockersSql,
        params: [jobId],
      });
      return mapDbJobToStateJob(job);
    },
    scheduleBlockedJobs: async ({ context, blockedBySequenceId }) => {
      const readyJobs = await executeTypedSql({
        context,
        sql: findReadyJobsSql,
        params: [blockedBySequenceId],
      });

      const scheduledJobs: StateJob[] = [];
      for (const { job_id } of readyJobs) {
        const [job] = await executeTypedSql({
          context,
          sql: scheduleBlockedJobSql,
          params: [job_id],
        });
        if (job) {
          scheduledJobs.push(mapDbJobToStateJob(job));
        }
      }

      return scheduledJobs;
    },
    getJobBlockers: async ({ context, jobId }) => {
      const rows = await executeTypedSql({
        context,
        sql: getJobBlockersSql,
        params: [jobId],
      });

      return rows.map((row) => {
        const { rootJob, lastSequenceJob } = parseDbJobSequenceRow(row);
        return [
          mapDbJobToStateJob(rootJob),
          lastSequenceJob && lastSequenceJob.id !== rootJob.id
            ? mapDbJobToStateJob(lastSequenceJob)
            : undefined,
        ];
      });
    },

    getNextJobAvailableInMs: async ({ context, typeNames }) => {
      const [result] = await executeTypedSql({
        context,
        sql: getNextJobAvailableInMsSql,
        params: [JSON.stringify(typeNames)],
      });
      return result ? result.available_in_ms : null;
    },
    acquireJob: async ({ context, typeNames }) => {
      const [job] = await executeTypedSql({
        context,
        sql: acquireJobSql,
        params: [JSON.stringify(typeNames)],
      });

      return job ? mapDbJobToStateJob(job) : undefined;
    },
    renewJobLease: async ({ context, jobId, workerId, leaseDurationMs }) => {
      const [job] = await executeTypedSql({
        context,
        sql: renewJobLeaseSql,
        params: [workerId, leaseDurationMs, jobId],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ context, jobId, schedule, error }) => {
      const scheduledAtIso = schedule.at?.toISOString().replace("T", " ").replace("Z", "") ?? null;
      const scheduleAfterMsOrNull = schedule.afterMs ?? null;
      const [job] = await executeTypedSql({
        context,
        sql: rescheduleJobSql,
        params: [
          scheduledAtIso,
          scheduleAfterMsOrNull,
          scheduleAfterMsOrNull,
          JSON.stringify(error),
          jobId,
        ],
      });

      return mapDbJobToStateJob(job);
    },
    completeJob: async ({ context, jobId, output, workerId }) => {
      const [job] = await executeTypedSql({
        context,
        sql: completeJobSql,
        params: [workerId, output !== undefined ? JSON.stringify(output) : null, jobId],
      });

      return mapDbJobToStateJob(job);
    },
    removeExpiredJobLease: async ({ context, typeNames }) => {
      const [job] = await executeTypedSql({
        context,
        sql: removeExpiredJobLeaseSql,
        params: [JSON.stringify(typeNames)],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
    getExternalBlockers: async ({ context, rootIds }) => {
      const rootIdsJson = JSON.stringify(rootIds);
      const blockers = await executeTypedSql({
        context,
        sql: getExternalBlockersSql,
        params: [rootIdsJson, rootIdsJson],
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
        params: [JSON.stringify(rootIds)],
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

export type SqliteStateAdapter<TContext extends BaseStateAdapterContext, TJobId> = StateAdapter<
  TContext,
  TJobId
>;
