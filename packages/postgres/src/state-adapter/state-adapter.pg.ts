import {
  type MigrationResult,
  type NamedParameter,
  type TypedSql,
  type UnwrapNamedParameters,
  createTemplateApplier,
  executeMigrations,
} from "@queuert/typed-sql";
import { type UUID } from "node:crypto";
import {
  type BaseTxContext,
  BlockerReferenceError,
  type StateAdapter,
  type StateJob,
} from "queuert";
import { type PgStateProvider } from "../state-provider/state-provider.pg.js";
import {
  type DbJob,
  acquireJobSql,
  addJobBlockersSql,
  checkExternalBlockerRefsSql,
  completeJobSql,
  createJobSql,
  createMigrationTableSql,
  deleteJobsByChainIdsSql,
  getAppliedMigrationsSql,
  getCurrentJobForUpdateSql,
  getJobBlockersSql,
  getJobByIdSql,
  getJobChainByIdSql,
  getJobForUpdateSql,
  getNextJobAvailableInMsSql,
  migrations,
  recordMigrationSql,
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

    traceContext: dbJob.trace_context,
  };
};

export const createPgStateAdapter = async <
  TTxContext extends BaseTxContext,
  TIdType extends string = UUID,
>({
  stateProvider,
  schema = "queuert",
  tablePrefix = "",
  idType = "uuid",
  idDefault = "gen_random_uuid()",
}: {
  stateProvider: PgStateProvider<TTxContext>;
  schema?: string;
  tablePrefix?: string;
  idType?: string;
  idDefault?: string;
  $idType?: TIdType;
}): Promise<
  StateAdapter<TTxContext, TIdType> & {
    migrateToLatest: () => Promise<MigrationResult>;
  }
> => {
  const applyTemplate = createTemplateApplier({
    schema,
    table_prefix: tablePrefix,
    id_type: idType,
    id_default: idDefault,
  });

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
    return stateProvider.executeSql({
      txContext,
      sql: applyTemplate(sql).sql,
      params,
    }) as Promise<TResult>;
  };

  const rawAdapter: StateAdapter<TTxContext, TIdType> = {
    runInTransaction: stateProvider.runInTransaction,

    getJobChainById: async ({ txContext, jobId }) => {
      const [jobChain] = await executeTypedSql({
        txContext,
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
      chainId,
      originId,
      deduplication,
      schedule,
      traceContext,
    }) => {
      const [result] = await executeTypedSql({
        txContext,
        sql: createJobSql,
        params: [
          typeName,
          chainId,
          chainTypeName,
          input,
          originId,
          deduplication?.key ?? null,
          deduplication ? (deduplication.scope ?? "incomplete") : null,
          deduplication?.windowMs ?? null,
          schedule?.at ?? null,
          schedule?.afterMs ?? null,
          traceContext ?? null,
        ],
      });

      return { job: mapDbJobToStateJob(result), deduplicated: result.deduplicated };
    },

    addJobBlockers: async ({ txContext, jobId, blockedByChainIds }) => {
      const [result] = await executeTypedSql({
        txContext,
        sql: addJobBlockersSql,
        params: [Array.from({ length: blockedByChainIds.length }, () => jobId), blockedByChainIds],
      });

      return {
        job: mapDbJobToStateJob(result),
        incompleteBlockerChainIds: result.incomplete_blocker_chain_ids,
      };
    },
    scheduleBlockedJobs: async ({ txContext, blockedByChainId }) => {
      const jobs = await executeTypedSql({
        txContext,
        sql: scheduleBlockedJobsSql,
        params: [blockedByChainId],
      });
      return jobs.map(mapDbJobToStateJob);
    },
    getJobBlockers: async ({ txContext, jobId }) => {
      const jobChains = await executeTypedSql({
        txContext,
        sql: getJobBlockersSql,
        params: [jobId],
      });

      return jobChains.map(({ root_job, last_chain_job }) => [
        mapDbJobToStateJob(root_job),
        last_chain_job ? mapDbJobToStateJob(last_chain_job) : undefined,
      ]);
    },

    getNextJobAvailableInMs: async ({ txContext, typeNames }) => {
      const [result] = await executeTypedSql({
        txContext,
        sql: getNextJobAvailableInMsSql,
        params: [typeNames],
      });
      return result ? result.available_in_ms : null;
    },
    acquireJob: async ({ txContext, typeNames }) => {
      const [result] = await executeTypedSql({
        txContext,
        sql: acquireJobSql,
        params: [typeNames],
      });

      return result
        ? { job: mapDbJobToStateJob(result), hasMore: result.has_more }
        : { job: undefined, hasMore: false };
    },
    renewJobLease: async ({ txContext, jobId, workerId, leaseDurationMs }) => {
      const [job] = await executeTypedSql({
        txContext,
        sql: renewJobLeaseSql,
        params: [jobId, workerId, leaseDurationMs],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ txContext, jobId, schedule, error }) => {
      const [job] = await executeTypedSql({
        txContext,
        sql: rescheduleJobSql,
        params: [jobId, schedule.at ?? null, schedule.afterMs ?? null, JSON.stringify(error)],
      });

      return mapDbJobToStateJob(job);
    },
    completeJob: async ({ txContext, jobId, output, workerId }) => {
      const [job] = await executeTypedSql({
        txContext,
        sql: completeJobSql,
        params: [jobId, output, workerId],
      });

      return mapDbJobToStateJob(job);
    },
    removeExpiredJobLease: async ({ txContext, typeNames, ignoredJobIds }) => {
      const [job] = await executeTypedSql({
        txContext,
        sql: removeExpiredJobLeaseSql,
        params: [typeNames, ignoredJobIds ?? []],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
    deleteJobsByChainIds: async ({ txContext, chainIds }) => {
      const refs = await executeTypedSql({
        txContext,
        sql: checkExternalBlockerRefsSql,
        params: [chainIds, chainIds],
      });
      if (refs.length > 0) {
        throw new BlockerReferenceError(
          `Cannot delete chains: ${[...new Set(refs.map((r) => r.blocked_by_chain_id))].join(", ")} referenced as blockers`,
          refs.map((r) => ({
            chainId: r.blocked_by_chain_id,
            referencedByJobId: r.job_id,
          })),
        );
      }
      const jobs = await executeTypedSql({
        txContext,
        sql: deleteJobsByChainIdsSql,
        params: [chainIds],
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
    ...rawAdapter,
    migrateToLatest: async () => {
      const runMigrations = await executeMigrations<TTxContext>({
        migrations,
        getAppliedMigrationNames: async (txContext) => {
          await stateProvider.executeSql({
            txContext,
            sql: applyTemplate(createMigrationTableSql).sql,
          });
          const applied = (await stateProvider.executeSql({
            txContext,
            sql: applyTemplate(getAppliedMigrationsSql).sql,
          })) as { name: string }[];
          return applied.map((m) => m.name);
        },
        executeMigrationStatements: async (txContext, migration) => {
          for (const stmt of migration.statements) {
            await stateProvider.executeSql({
              txContext,
              sql: applyTemplate(stmt.sql).sql,
            });
          }
        },
        recordMigration: async (txContext, name) => {
          await stateProvider.executeSql({
            txContext,
            sql: applyTemplate(recordMigrationSql).sql,
            params: [name],
          });
        },
      });

      return stateProvider.runInTransaction(runMigrations);
    },
  };
};

export type PgStateAdapter<TTxContext extends BaseTxContext, TJobId extends string> = StateAdapter<
  TTxContext,
  TJobId
>;
