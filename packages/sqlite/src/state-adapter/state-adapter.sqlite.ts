import {
  createTemplateApplier,
  type NamedParameter,
  type TypedSql,
  type UnwrapNamedParameters,
} from "@queuert/typed-sql";
import { UUID } from "crypto";
import { type BaseTxContext, type RetryConfig, type StateAdapter, type StateJob } from "queuert";
import { wrapStateAdapterWithRetry } from "queuert/internal";
import { SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";
import { isTransientSqliteError } from "./errors.js";
import {
  acquireJobSql,
  checkBlockersStatusSql,
  completeJobSql,
  type DbJob,
  type DbJobChainRow,
  deleteJobsByRootChainIdsSql,
  findExistingJobSql,
  findReadyJobsSql,
  getCurrentJobForUpdateSql,
  getExternalBlockersSql,
  getJobBlockersSql,
  getJobByIdForBlockersSql,
  getJobByIdSql,
  getJobChainByIdSql,
  getJobForUpdateSql,
  getNextJobAvailableInMsSql,
  insertJobBlockersSql,
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
    chainId: dbJob.chain_id,
    chainTypeName: dbJob.chain_type_name,
    input: parseJson(dbJob.input),
    output: parseJson(dbJob.output),

    rootChainId: dbJob.root_chain_id,
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

const parseDbJobChainRow = (row: DbJobChainRow): { rootJob: DbJob; lastChainJob: DbJob | null } => {
  const rootJob: DbJob = {
    id: row.id,
    type_name: row.type_name,
    chain_id: row.chain_id,
    chain_type_name: row.chain_type_name,
    input: row.input,
    output: row.output,
    root_chain_id: row.root_chain_id,
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

  const lastChainJob: DbJob | null = row.lc_id
    ? {
        id: row.lc_id,
        type_name: row.lc_type_name!,
        chain_id: row.lc_chain_id!,
        chain_type_name: row.lc_chain_type_name!,
        input: row.lc_input,
        output: row.lc_output,
        root_chain_id: row.lc_root_chain_id!,
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

  return { rootJob, lastChainJob };
};

export const createSqliteStateAdapter = async <
  TTxContext extends BaseTxContext,
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
  stateProvider: SqliteStateProvider<TTxContext>;
  connectionRetryConfig?: RetryConfig;
  isTransientError?: (error: unknown) => boolean;
  tablePrefix?: string;
  idType?: string;
  idGenerator?: () => TIdType;
}): Promise<
  StateAdapter<TTxContext, TIdType> & {
    migrateToLatest: () => Promise<void>;
  }
> => {
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
    txContext,
    sql,
    params,
  }: {
    txContext?: TTxContext;
    sql: TypedSql<TParams, TResult>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: UnwrapNamedParameters<TParams> })): Promise<TResult> => {
    const resolvedSql = applyTemplate(sql);
    return stateProvider.executeSql({
      txContext,
      sql: resolvedSql.sql,
      params,
      returns: resolvedSql.returns,
    }) as Promise<TResult>;
  };

  const rawAdapter: StateAdapter<TTxContext, TIdType> = {
    runInTransaction: stateProvider.runInTransaction,

    getJobChainById: async ({ txContext, jobId }) => {
      const [row] = await executeTypedSql({
        txContext,
        sql: getJobChainByIdSql,
        params: [jobId, jobId],
      });

      if (!row) return undefined;

      const { rootJob, lastChainJob } = parseDbJobChainRow(row);

      return [
        mapDbJobToStateJob(rootJob),
        lastChainJob && lastChainJob.id !== rootJob.id
          ? mapDbJobToStateJob(lastChainJob)
          : undefined,
      ];
    },
    getJobById: async ({ txContext, jobId }) => {
      const [job] = await executeTypedSql({
        txContext,
        sql: getJobByIdSql,
        params: [jobId],
      });

      return job ? mapDbJobToStateJob(job) : undefined;
    },

    createJob: async ({
      txContext,
      typeName,
      chainTypeName,
      input,
      rootChainId,
      chainId,
      originId,
      deduplication,
      schedule,
    }) => {
      const newId = idGenerator();
      const inputJson = input !== undefined ? JSON.stringify(input) : null;
      const deduplicationKey = deduplication?.key ?? null;
      const deduplicationStrategy = deduplication ? (deduplication.strategy ?? "completed") : null;
      const deduplicationWindowMs = deduplication?.windowMs ?? null;

      const chainIdOrNull = chainId ?? null;
      const originIdOrNull = originId ?? null;
      const rootChainIdOrNull = rootChainId ?? null;
      const scheduledAtIso = schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null;
      const scheduleAfterMsOrNull = schedule?.afterMs ?? null;

      const [existing] = await executeTypedSql({
        txContext,
        sql: findExistingJobSql,
        params: [
          chainIdOrNull,
          originIdOrNull,
          chainIdOrNull,
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
        txContext,
        sql: insertJobSql,
        params: [
          newId,
          typeName,
          chainIdOrNull,
          newId,
          chainTypeName,
          inputJson,
          rootChainIdOrNull,
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

    addJobBlockers: async ({ txContext, jobId, blockedByChainIds }) => {
      await executeTypedSql({
        txContext,
        sql: insertJobBlockersSql,
        params: [jobId, JSON.stringify(blockedByChainIds)],
      });

      const blockerStatuses = await executeTypedSql({
        txContext,
        sql: checkBlockersStatusSql,
        params: [jobId],
      });

      const incompleteBlockerChainIds = blockerStatuses
        .filter((b) => b.blocker_status !== "completed")
        .map((b) => b.blocked_by_chain_id);

      if (incompleteBlockerChainIds.length > 0) {
        const [updatedJob] = await executeTypedSql({
          txContext,
          sql: updateJobToBlockedSql,
          params: [jobId],
        });
        if (updatedJob) {
          return { job: mapDbJobToStateJob(updatedJob), incompleteBlockerChainIds };
        }
      }

      const [job] = await executeTypedSql({
        txContext,
        sql: getJobByIdForBlockersSql,
        params: [jobId],
      });
      return { job: mapDbJobToStateJob(job), incompleteBlockerChainIds: [] };
    },
    scheduleBlockedJobs: async ({ txContext, blockedByChainId }) => {
      const readyJobs = await executeTypedSql({
        txContext,
        sql: findReadyJobsSql,
        params: [blockedByChainId],
      });

      const scheduledJobs: StateJob[] = [];
      for (const { job_id } of readyJobs) {
        const [job] = await executeTypedSql({
          txContext,
          sql: scheduleBlockedJobSql,
          params: [job_id],
        });
        if (job) {
          scheduledJobs.push(mapDbJobToStateJob(job));
        }
      }

      return scheduledJobs;
    },
    getJobBlockers: async ({ txContext, jobId }) => {
      const rows = await executeTypedSql({
        txContext,
        sql: getJobBlockersSql,
        params: [jobId],
      });

      return rows.map((row) => {
        const { rootJob, lastChainJob } = parseDbJobChainRow(row);
        return [
          mapDbJobToStateJob(rootJob),
          lastChainJob && lastChainJob.id !== rootJob.id
            ? mapDbJobToStateJob(lastChainJob)
            : undefined,
        ];
      });
    },

    getNextJobAvailableInMs: async ({ txContext, typeNames }) => {
      const [result] = await executeTypedSql({
        txContext,
        sql: getNextJobAvailableInMsSql,
        params: [JSON.stringify(typeNames)],
      });
      return result ? result.available_in_ms : null;
    },
    acquireJob: async ({ txContext, typeNames }) => {
      const [job] = await executeTypedSql({
        txContext,
        sql: acquireJobSql,
        params: [JSON.stringify(typeNames)],
      });

      return job ? mapDbJobToStateJob(job) : undefined;
    },
    renewJobLease: async ({ txContext, jobId, workerId, leaseDurationMs }) => {
      const [job] = await executeTypedSql({
        txContext,
        sql: renewJobLeaseSql,
        params: [workerId, leaseDurationMs, jobId],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ txContext, jobId, schedule, error }) => {
      const scheduledAtIso = schedule.at?.toISOString().replace("T", " ").replace("Z", "") ?? null;
      const scheduleAfterMsOrNull = schedule.afterMs ?? null;
      const [job] = await executeTypedSql({
        txContext,
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
    completeJob: async ({ txContext, jobId, output, workerId }) => {
      const [job] = await executeTypedSql({
        txContext,
        sql: completeJobSql,
        params: [workerId, output !== undefined ? JSON.stringify(output) : null, jobId],
      });

      return mapDbJobToStateJob(job);
    },
    removeExpiredJobLease: async ({ txContext, typeNames }) => {
      const [job] = await executeTypedSql({
        txContext,
        sql: removeExpiredJobLeaseSql,
        params: [JSON.stringify(typeNames)],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
    getExternalBlockers: async ({ txContext, rootChainIds }) => {
      const rootChainIdsJson = JSON.stringify(rootChainIds);
      const blockers = await executeTypedSql({
        txContext,
        sql: getExternalBlockersSql,
        params: [rootChainIdsJson, rootChainIdsJson],
      });
      return blockers.map((b) => ({
        jobId: b.job_id as TIdType,
        blockedRootChainId: b.blocked_root_chain_id as TIdType,
      }));
    },
    deleteJobsByRootChainIds: async ({ txContext, rootChainIds }) => {
      const jobs = await executeTypedSql({
        txContext,
        sql: deleteJobsByRootChainIdsSql,
        params: [JSON.stringify(rootChainIds)],
      });
      return jobs.map(mapDbJobToStateJob);
    },
    getJobForUpdate: async ({ txContext, jobId }) => {
      const [job] = await executeTypedSql({
        txContext,
        sql: getJobForUpdateSql,
        params: [jobId],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
    getCurrentJobForUpdate: async ({ txContext, chainId }) => {
      const [job] = await executeTypedSql({
        txContext,
        sql: getCurrentJobForUpdateSql,
        params: [chainId],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
  };

  return {
    ...wrapStateAdapterWithRetry({
      stateAdapter: rawAdapter,
      retryConfig: connectionRetryConfig,
      isRetryableError: isTransientError,
    }),
    migrateToLatest: async () => {
      await stateProvider.executeSql({
        sql: applyTemplate(migrateSql).sql,
        returns: false,
      });
    },
  };
};

export type SqliteStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string,
> = StateAdapter<TTxContext, TJobId>;
