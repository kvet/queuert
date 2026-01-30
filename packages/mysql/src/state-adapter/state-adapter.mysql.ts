import {
  type NamedParameter,
  type TypedSql,
  type UnwrapNamedParameters,
  createTemplateApplier,
  groupMigrationStatements,
} from "@queuert/typed-sql";
import { type UUID } from "node:crypto";
import { type BaseTxContext, type RetryConfig, type StateAdapter, type StateJob } from "queuert";
import { wrapStateAdapterWithRetry } from "queuert/internal";
import { type MysqlStateProvider } from "../state-provider/state-provider.mysql.js";
import { isTransientMysqlError } from "./errors.js";
import {
  type DbJob,
  type DbJobChainRow,
  checkBlockersStatusSql,
  completeJobSql,
  deleteJobsByRootChainIdsSql,
  findExistingJobSql,
  findReadyJobsSql,
  getAcquiredJobWithHasMoreSql,
  getCompletedJobSql,
  getCurrentJobForUpdateSql,
  getExternalBlockersSql,
  getJobBlockersSql,
  getJobByIdForBlockersSql,
  getJobByIdSql,
  getJobByIdWithDedupSql,
  getJobChainByIdSql,
  getJobForUpdateSql,
  getNextJobAvailableInMsSql,
  getRenewedJobSql,
  getRescheduledJobSql,
  getScheduledJobSql,
  getUpdatedExpiredLeaseSql,
  insertJobBlockersSql,
  insertJobSql,
  jobColumnsPrefixedSelect,
  jobColumnsSelect,
  migrationStatements,
  renewJobLeaseSql,
  rescheduleJobSql,
  scheduleBlockedJobSql,
  selectExpiredLeaseSql,
  selectJobToAcquireSql,
  selectJobsToDeleteSql,
  updateAcquiredJobSql,
  updateExpiredLeaseSql,
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

const formatDateForMysql = (date: Date): string => {
  return date.toISOString().replace("T", " ").slice(0, -1);
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
    createdAt: new Date(dbJob.created_at),
    scheduledAt: new Date(dbJob.scheduled_at),
    completedAt: dbJob.completed_at ? new Date(dbJob.completed_at) : null,
    completedBy: dbJob.completed_by,

    attempt: dbJob.attempt,
    lastAttemptError: parseJson(dbJob.last_attempt_error) as string | null,
    lastAttemptAt: dbJob.last_attempt_at ? new Date(dbJob.last_attempt_at) : null,

    leasedBy: dbJob.leased_by,
    leasedUntil: dbJob.leased_until ? new Date(dbJob.leased_until) : null,

    deduplicationKey: dbJob.deduplication_key,

    updatedAt: new Date(dbJob.updated_at),
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

export const createMysqlStateAdapter = async <
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
  isTransientError = isTransientMysqlError,
  tablePrefix = "queuert_",
  idType = "CHAR(36)",
  idGenerator = () => crypto.randomUUID() as TIdType,
}: {
  stateProvider: MysqlStateProvider<TTxContext>;
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
      const scheduledAtMysql = schedule?.at ? formatDateForMysql(schedule.at) : null;
      const scheduleAfterMs = schedule?.afterMs ?? null;

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

      await executeTypedSql({
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
          scheduledAtMysql,
          scheduleAfterMs,
          scheduleAfterMs,
        ],
      });

      const [result] = await executeTypedSql({
        txContext,
        sql: getJobByIdWithDedupSql,
        params: [newId],
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
        await executeTypedSql({
          txContext,
          sql: updateJobToBlockedSql,
          params: [jobId],
        });
      }

      const [job] = await executeTypedSql({
        txContext,
        sql: getJobByIdForBlockersSql,
        params: [jobId],
      });
      return {
        job: mapDbJobToStateJob(job),
        incompleteBlockerChainIds:
          incompleteBlockerChainIds.length > 0 ? incompleteBlockerChainIds : [],
      };
    },
    scheduleBlockedJobs: async ({ txContext, blockedByChainId }) => {
      const readyJobs = await executeTypedSql({
        txContext,
        sql: findReadyJobsSql,
        params: [blockedByChainId],
      });

      const scheduledJobs: StateJob[] = [];
      for (const { job_id } of readyJobs) {
        await executeTypedSql({
          txContext,
          sql: scheduleBlockedJobSql,
          params: [job_id],
        });
        const [job] = await executeTypedSql({
          txContext,
          sql: getScheduledJobSql,
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
      const typeNamesJson = JSON.stringify(typeNames);

      const [selected] = await executeTypedSql({
        txContext,
        sql: selectJobToAcquireSql,
        params: [typeNamesJson],
      });

      if (!selected) {
        return { job: undefined, hasMore: false };
      }

      await executeTypedSql({
        txContext,
        sql: updateAcquiredJobSql,
        params: [selected.id],
      });

      const [result] = await executeTypedSql({
        txContext,
        sql: getAcquiredJobWithHasMoreSql,
        params: [typeNamesJson, selected.id],
      });

      return { job: mapDbJobToStateJob(result), hasMore: result.has_more === 1 };
    },
    renewJobLease: async ({ txContext, jobId, workerId, leaseDurationMs }) => {
      await executeTypedSql({
        txContext,
        sql: renewJobLeaseSql,
        params: [workerId, leaseDurationMs, jobId],
      });

      const [job] = await executeTypedSql({
        txContext,
        sql: getRenewedJobSql,
        params: [jobId],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ txContext, jobId, schedule, error }) => {
      const scheduledAtMysql = schedule.at ? formatDateForMysql(schedule.at) : null;
      const scheduleAfterMs = schedule.afterMs ?? null;

      await executeTypedSql({
        txContext,
        sql: rescheduleJobSql,
        params: [scheduledAtMysql, scheduleAfterMs, scheduleAfterMs, JSON.stringify(error), jobId],
      });

      const [job] = await executeTypedSql({
        txContext,
        sql: getRescheduledJobSql,
        params: [jobId],
      });

      return mapDbJobToStateJob(job);
    },
    completeJob: async ({ txContext, jobId, output, workerId }) => {
      await executeTypedSql({
        txContext,
        sql: completeJobSql,
        params: [workerId, output !== undefined ? JSON.stringify(output) : null, jobId],
      });

      const [job] = await executeTypedSql({
        txContext,
        sql: getCompletedJobSql,
        params: [jobId],
      });

      return mapDbJobToStateJob(job);
    },
    removeExpiredJobLease: async ({ txContext, typeNames }) => {
      const typeNamesJson = JSON.stringify(typeNames);

      const [selected] = await executeTypedSql({
        txContext,
        sql: selectExpiredLeaseSql,
        params: [typeNamesJson],
      });

      if (!selected) {
        return undefined;
      }

      await executeTypedSql({
        txContext,
        sql: updateExpiredLeaseSql,
        params: [selected.id],
      });

      const [job] = await executeTypedSql({
        txContext,
        sql: getUpdatedExpiredLeaseSql,
        params: [selected.id],
      });

      return mapDbJobToStateJob(job);
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
      const rootChainIdsJson = JSON.stringify(rootChainIds);

      const jobs = await executeTypedSql({
        txContext,
        sql: selectJobsToDeleteSql,
        params: [rootChainIdsJson],
      });

      await executeTypedSql({
        txContext,
        sql: deleteJobsByRootChainIdsSql,
        params: [rootChainIdsJson],
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
      const groups = groupMigrationStatements(migrationStatements);

      const isDuplicateKeyError = (err: unknown): boolean => {
        const error = err as Error & { errno?: number; code?: string };
        // MySQL error 1061: Duplicate key name (for CREATE INDEX)
        // MySQL error 1050: Table already exists
        return error.errno === 1061 || error.errno === 1050;
      };

      for (const group of groups) {
        if (group.noTransaction) {
          try {
            await stateProvider.executeSql({
              sql: applyTemplate(group.statements[0].sql).sql,
            });
          } catch (err) {
            if (!isDuplicateKeyError(err)) {
              throw err;
            }
          }
        } else {
          await stateProvider.runInTransaction(async (txContext) => {
            for (const stmt of group.statements) {
              try {
                await stateProvider.executeSql({
                  txContext,
                  sql: applyTemplate(stmt.sql).sql,
                });
              } catch (err) {
                if (!isDuplicateKeyError(err)) {
                  throw err;
                }
              }
            }
          });
        }
      }
    },
  };
};

export type MysqlStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string,
> = StateAdapter<TTxContext, TJobId>;
