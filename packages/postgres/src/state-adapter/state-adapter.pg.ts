import {
  createTemplateApplier,
  type NamedParameter,
  type TypedSql,
  type UnwrapNamedParameters,
} from "@queuert/typed-sql";
import { UUID } from "crypto";
import {
  type BaseStateAdapterContext,
  type RetryConfig,
  type StateAdapter,
  type StateJob,
} from "queuert";
import { wrapStateAdapterWithRetry } from "queuert/internal";
import { PgStateProvider } from "../state-provider/state-provider.pg.js";
import { isTransientPgError } from "./errors.js";
import {
  acquireJobSql,
  addJobBlockersSql,
  completeJobSql,
  createJobSql,
  type DbJob,
  deleteJobsByRootChainIdsSql,
  getCurrentJobForUpdateSql,
  getExternalBlockersSql,
  getJobBlockersSql,
  getJobByIdSql,
  getJobForUpdateSql,
  getJobChainByIdSql,
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
    chainId: dbJob.chain_id,
    chainTypeName: dbJob.chain_type_name,
    input: dbJob.input,
    output: dbJob.output,

    rootChainId: dbJob.root_chain_id,
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

export const createPgStateAdapter = async <
  TTxContext extends BaseStateAdapterContext,
  TContext extends BaseStateAdapterContext = TTxContext,
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
  stateProvider: PgStateProvider<TTxContext, TContext>;
  connectionRetryConfig?: RetryConfig;
  isTransientError?: (error: unknown) => boolean;
  schema?: string;
  idType?: string;
  idDefault?: string;
  $idType?: TIdType;
}): Promise<
  StateAdapter<TTxContext, TContext, TIdType> & {
    migrateToLatest: () => Promise<void>;
  }
> => {
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
    context: TTxContext | TContext;
    sql: TypedSql<TParams, TResult>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: UnwrapNamedParameters<TParams> })): Promise<TResult> => {
    return stateProvider.executeSql(context, applyTemplate(sql).sql, params) as Promise<TResult>;
  };

  const rawAdapter: StateAdapter<TTxContext, TContext, TIdType> = {
    provideContext: stateProvider.provideContext,
    runInTransaction: stateProvider.runInTransaction,
    isInTransaction: stateProvider.isInTransaction,

    getJobChainById: async ({ context, jobId }) => {
      const [jobChain] = await executeTypedSql({
        context,
        sql: getJobChainByIdSql,
        params: [jobId],
      });

      return jobChain
        ? [
            mapDbJobToStateJob(jobChain.root_job),
            jobChain.last_chain_job ? mapDbJobToStateJob(jobChain.last_chain_job) : undefined,
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
      chainTypeName,
      input,
      rootChainId,
      chainId,
      originId,
      deduplication,
      schedule,
    }) => {
      const [result] = await executeTypedSql({
        context,
        sql: createJobSql,
        params: [
          typeName,
          chainId,
          chainTypeName,
          input,
          rootChainId,
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

    addJobBlockers: async ({ context, jobId, blockedByChainIds }) => {
      const [result] = await executeTypedSql({
        context,
        sql: addJobBlockersSql,
        params: [Array.from({ length: blockedByChainIds.length }, () => jobId), blockedByChainIds],
      });

      return {
        job: mapDbJobToStateJob(result),
        incompleteBlockerChainIds: result.incomplete_blocker_chain_ids,
      };
    },
    scheduleBlockedJobs: async ({ context, blockedByChainId }) => {
      const jobs = await executeTypedSql({
        context,
        sql: scheduleBlockedJobsSql,
        params: [blockedByChainId],
      });
      return jobs.map(mapDbJobToStateJob);
    },
    getJobBlockers: async ({ context, jobId }) => {
      const jobChains = await executeTypedSql({
        context,
        sql: getJobBlockersSql,
        params: [jobId],
      });

      return jobChains.map(({ root_job, last_chain_job }) => [
        mapDbJobToStateJob(root_job),
        last_chain_job ? mapDbJobToStateJob(last_chain_job) : undefined,
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
    getExternalBlockers: async ({ context, rootChainIds }) => {
      const blockers = await executeTypedSql({
        context,
        sql: getExternalBlockersSql,
        params: [rootChainIds],
      });
      return blockers.map((b) => ({
        jobId: b.job_id as TIdType,
        blockedRootChainId: b.blocked_root_chain_id as TIdType,
      }));
    },
    deleteJobsByRootChainIds: async ({ context, rootChainIds }) => {
      const jobs = await executeTypedSql({
        context,
        sql: deleteJobsByRootChainIdsSql,
        params: [rootChainIds],
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
    getCurrentJobForUpdate: async ({ context, chainId }) => {
      const [job] = await executeTypedSql({
        context,
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
      await stateProvider.provideContext(async (context) => {
        await executeTypedSql({
          context,
          sql: migrateSql,
        });
      });
    },
  };
};

export type PgStateAdapter<
  TTxContext extends BaseStateAdapterContext,
  TContext extends BaseStateAdapterContext,
  TJobId extends string,
> = StateAdapter<TTxContext, TContext, TJobId>;
