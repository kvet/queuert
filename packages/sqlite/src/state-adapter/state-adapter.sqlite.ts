import {
  BaseStateAdapterContext,
  type RetryConfig,
  type StateAdapter,
  type StateJob,
} from "@queuert/core";
import { withRetry } from "@queuert/core/internal";
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
  migrateSql,
  removeExpiredJobLeaseSql,
  renewJobLeaseSql,
  rescheduleJobSql,
  scheduleBlockedJobSql,
  updateJobToBlockedSql,
} from "./sql.js";
import { type NamedParameter, type TypedSql, type UnwrapNamedParameters } from "@queuert/typed-sql";

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
  return {
    rootJob: JSON.parse(row.root_job) as DbJob,
    lastSequenceJob: row.last_sequence_job ? (JSON.parse(row.last_sequence_job) as DbJob) : null,
  };
};

export const createSqliteStateAdapter = <TContext extends BaseStateAdapterContext>({
  stateProvider,
  connectionRetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    multiplier: 5.0,
    maxDelayMs: 10 * 1000,
  },
  isTransientError = isTransientSqliteError,
}: {
  stateProvider: SqliteStateProvider<TContext>;
  connectionRetryConfig?: RetryConfig;
  isTransientError?: (error: unknown) => boolean;
}): StateAdapter<TContext> & {
  migrateToLatest: (context: TContext) => Promise<void>;
} => {
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
    : { params: UnwrapNamedParameters<TParams> })): Promise<TResult> =>
    withRetry(
      async () => stateProvider.executeSql<TResult>(context, sql.sql, params, sql.returns),
      connectionRetryConfig,
      { isRetryableError: isTransientError },
    );

  return {
    provideContext: async (fn) => stateProvider.provideContext(fn),
    runInTransaction: async (context, fn) => stateProvider.runInTransaction(context, fn),
    assertInTransaction: async (context) => stateProvider.assertInTransaction(context),

    migrateToLatest: async (context) => {
      const db = (context as unknown as { db: { exec: (sql: string) => void } }).db;
      db.exec(migrateSql.sql);
    },

    getJobSequenceById: async ({ context, jobId }) => {
      // Anonymous ? params: jobId (for sequence_id), jobId (for j.id)
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
    }) => {
      const newId = crypto.randomUUID();
      const inputJson = input !== undefined ? JSON.stringify(input) : null;
      const deduplicationKey = deduplication?.key ?? null;
      const deduplicationStrategy = deduplication ? (deduplication.strategy ?? "completed") : null;
      const deduplicationWindowMs = deduplication?.windowMs ?? null;

      // Convert undefined to null for SQLite compatibility
      const sequenceIdOrNull = sequenceId ?? null;
      const originIdOrNull = originId ?? null;
      const rootIdOrNull = rootId ?? null;

      // First, check for existing job (continuation or deduplication)
      // Anonymous ? params: sequenceId, originId, sequenceId, originId, deduplicationKey, deduplicationKey,
      //                     deduplicationStrategy, deduplicationStrategy, deduplicationStrategy,
      //                     deduplicationWindowMs, deduplicationWindowMs
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

      // No existing job, insert new one
      // Anonymous ? params: newId, typeName, inputJson, rootId, newId, sequenceId, newId, originId, deduplicationKey
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
        ],
      });

      return { job: mapDbJobToStateJob(result), deduplicated: false };
    },

    addJobBlockers: async ({ context, jobId, blockedBySequenceIds }) => {
      // Insert blockers one by one (SQLite doesn't support INSERT inside CTE)
      for (let i = 0; i < blockedBySequenceIds.length; i++) {
        await executeTypedSql({
          context,
          sql: insertJobBlockerSql,
          params: [jobId, blockedBySequenceIds[i], i],
        });
      }

      // Check if any blockers are incomplete
      const blockerStatuses = await executeTypedSql({
        context,
        sql: checkBlockersStatusSql,
        params: [jobId],
      });

      const hasIncompleteBlockers = blockerStatuses.some((b) => b.blocker_status !== "completed");

      if (hasIncompleteBlockers) {
        // Update job to blocked status
        const [updatedJob] = await executeTypedSql({
          context,
          sql: updateJobToBlockedSql,
          params: [jobId],
        });
        if (updatedJob) {
          return mapDbJobToStateJob(updatedJob);
        }
      }

      // Return the job as-is
      const [job] = await executeTypedSql({
        context,
        sql: getJobByIdForBlockersSql,
        params: [jobId],
      });
      return mapDbJobToStateJob(job);
    },
    scheduleBlockedJobs: async ({ context, blockedBySequenceId }) => {
      // Find jobs that are ready to be unblocked
      const readyJobs = await executeTypedSql({
        context,
        sql: findReadyJobsSql,
        params: [blockedBySequenceId],
      });

      // Update each ready job
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
        ] as [StateJob, StateJob | undefined];
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
      // Anonymous ? params: leased_by, lease_duration_ms, id
      const [job] = await executeTypedSql({
        context,
        sql: renewJobLeaseSql,
        params: [workerId, leaseDurationMs, jobId],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ context, jobId, afterMs, error }) => {
      // Anonymous ? params: delay_ms, error, id
      const [job] = await executeTypedSql({
        context,
        sql: rescheduleJobSql,
        params: [afterMs, JSON.stringify(error), jobId],
      });

      return mapDbJobToStateJob(job);
    },
    completeJob: async ({ context, jobId, output, workerId }) => {
      // Anonymous ? params: completed_by, output, id
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
      // Anonymous ? params: rootIdsJson (for first json_each), rootIdsJson (for second json_each)
      const blockers = await executeTypedSql({
        context,
        sql: getExternalBlockersSql,
        params: [rootIdsJson, rootIdsJson],
      });
      return blockers.map((b) => ({ jobId: b.job_id, blockedRootId: b.blocked_root_id }));
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

export type SqliteStateAdapter<TContext extends BaseStateAdapterContext = BaseStateAdapterContext> =
  StateAdapter<TContext>;
