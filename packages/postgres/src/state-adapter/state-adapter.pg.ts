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
import { decodeCursor, encodeCursor } from "queuert/internal";
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
  getJobsBlockedByChainSql,
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
    chainIndex: dbJob.chain_index,
    input: dbJob.input,
    output: dbJob.output,

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
    txCtx,
    sql,
    params,
  }: {
    txCtx?: TTxContext;
    sql: TypedSql<TParams, TResult>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: UnwrapNamedParameters<TParams> })): Promise<TResult> => {
    return stateProvider.executeSql({
      txCtx,
      sql: applyTemplate(sql).sql,
      params,
    }) as Promise<TResult>;
  };

  const rawAdapter: StateAdapter<TTxContext, TIdType> = {
    runInTransaction: stateProvider.runInTransaction,

    getJobChainById: async ({ txCtx, jobId }) => {
      const [jobChain] = await executeTypedSql({
        txCtx,
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
    getJobById: async ({ txCtx, jobId }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: getJobByIdSql,
        params: [jobId],
      });

      return job ? mapDbJobToStateJob(job) : undefined;
    },

    createJob: async ({
      txCtx,
      typeName,
      chainTypeName,
      chainIndex,
      input,
      chainId,
      deduplication,
      schedule,
      traceContext,
    }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: createJobSql,
        params: [
          typeName,
          chainId,
          chainTypeName,
          input,
          deduplication?.key ?? null,
          deduplication ? (deduplication.scope ?? "incomplete") : null,
          deduplication?.windowMs ?? null,
          schedule?.at ?? null,
          schedule?.afterMs ?? null,
          traceContext ?? null,
          chainIndex,
        ],
      });

      return { job: mapDbJobToStateJob(result), deduplicated: result.deduplicated };
    },

    addJobBlockers: async ({ txCtx, jobId, blockedByChainIds, blockerTraceContexts }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: addJobBlockersSql,
        params: [
          Array.from({ length: blockedByChainIds.length }, () => jobId),
          blockedByChainIds,
          blockerTraceContexts ?? Array.from({ length: blockedByChainIds.length }, () => null),
        ],
      });

      return {
        job: mapDbJobToStateJob(result),
        incompleteBlockerChainIds: result.incomplete_blocker_chain_ids,
        blockerChainTraceContexts: result.blocker_chain_trace_contexts,
      };
    },
    scheduleBlockedJobs: async ({ txCtx, blockedByChainId }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: scheduleBlockedJobsSql,
        params: [blockedByChainId],
      });
      return {
        unblockedJobs: result.unblocked_jobs.map(mapDbJobToStateJob),
        blockerTraceContexts: result.blocker_trace_contexts,
      };
    },
    getJobBlockers: async ({ txCtx, jobId }) => {
      const jobChains = await executeTypedSql({
        txCtx,
        sql: getJobBlockersSql,
        params: [jobId],
      });

      return jobChains.map(({ root_job, last_chain_job }) => [
        mapDbJobToStateJob(root_job),
        last_chain_job ? mapDbJobToStateJob(last_chain_job) : undefined,
      ]);
    },

    getNextJobAvailableInMs: async ({ txCtx, typeNames }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: getNextJobAvailableInMsSql,
        params: [typeNames],
      });
      return result ? result.available_in_ms : null;
    },
    acquireJob: async ({ txCtx, typeNames }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: acquireJobSql,
        params: [typeNames],
      });

      return result
        ? { job: mapDbJobToStateJob(result), hasMore: result.has_more }
        : { job: undefined, hasMore: false };
    },
    renewJobLease: async ({ txCtx, jobId, workerId, leaseDurationMs }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: renewJobLeaseSql,
        params: [jobId, workerId, leaseDurationMs],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ txCtx, jobId, schedule, error }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: rescheduleJobSql,
        params: [jobId, schedule.at ?? null, schedule.afterMs ?? null, JSON.stringify(error)],
      });

      return mapDbJobToStateJob(job);
    },
    completeJob: async ({ txCtx, jobId, output, workerId }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: completeJobSql,
        params: [jobId, output, workerId],
      });

      return mapDbJobToStateJob(job);
    },
    removeExpiredJobLease: async ({ txCtx, typeNames, ignoredJobIds }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: removeExpiredJobLeaseSql,
        params: [typeNames, ignoredJobIds ?? []],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
    deleteJobsByChainIds: async ({ txCtx, chainIds }) => {
      const refs = await executeTypedSql({
        txCtx,
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
      const rows = await executeTypedSql({
        txCtx,
        sql: deleteJobsByChainIdsSql,
        params: [chainIds],
      });
      return rows.map((row) => [
        mapDbJobToStateJob(row.root_job),
        row.last_chain_job && row.last_chain_job.id !== row.root_job.id
          ? mapDbJobToStateJob(row.last_chain_job)
          : undefined,
      ]);
    },
    getJobForUpdate: async ({ txCtx, jobId }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: getJobForUpdateSql,
        params: [jobId],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
    getCurrentJobForUpdate: async ({ txCtx, chainId }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: getCurrentJobForUpdateSql,
        params: [chainId],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },

    listChains: async ({ txCtx, filter, page }) => {
      const cursor = page.cursor ? decodeCursor(page.cursor) : null;
      const conditions: string[] = ["root_job.chain_index = 0"];
      const params: unknown[] = [];
      let p = 1;

      if (filter?.typeName?.length) {
        conditions.push(`root_job.type_name = ANY($${p}::text[])`);
        params.push(filter.typeName);
        p++;
      }
      if (filter?.rootOnly) {
        conditions.push(
          `NOT EXISTS (SELECT 1 FROM ${schema}.${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = root_job.chain_id)`,
        );
      }
      if (filter?.id) {
        conditions.push(
          `(root_job.chain_id = $${p}::${idType} OR root_job.chain_id IN (SELECT chain_id FROM ${schema}.${tablePrefix}job WHERE id = $${p}::${idType}))`,
        );
        params.push(filter.id);
        p++;
      }
      if (cursor) {
        conditions.push(
          `(root_job.created_at < $${p}::timestamptz OR (root_job.created_at = $${p}::timestamptz AND root_job.id < $${p + 1}::${idType}))`,
        );
        params.push(cursor.createdAt, cursor.id);
        p += 2;
      }
      params.push(page.limit + 1);

      const sqlStr = `SELECT row_to_json(root_job) AS root_job, row_to_json(last_job) AS last_chain_job FROM ${schema}.${tablePrefix}job root_job LEFT JOIN LATERAL (SELECT * FROM ${schema}.${tablePrefix}job WHERE chain_id = root_job.id ORDER BY chain_index DESC LIMIT 1) last_job ON TRUE WHERE ${conditions.join(" AND ")} ORDER BY root_job.created_at DESC, root_job.id DESC LIMIT $${p}`;

      const rows = (await stateProvider.executeSql({
        txCtx,
        sql: sqlStr,
        params,
      })) as { root_job: DbJob; last_chain_job: DbJob }[];

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;

      const items: [StateJob, StateJob | undefined][] = pageRows.map((row) => {
        const rootJob = mapDbJobToStateJob(row.root_job);
        const lastJob =
          row.last_chain_job && row.last_chain_job.id !== row.root_job.id
            ? mapDbJobToStateJob(row.last_chain_job)
            : undefined;
        return [rootJob, lastJob];
      });

      const lastItem = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastItem) {
        nextCursor = encodeCursor({
          id: lastItem.root_job.id,
          createdAt: new Date(lastItem.root_job.created_at).toISOString(),
        });
      }

      return { items, nextCursor };
    },

    listJobs: async ({ txCtx, filter, page }) => {
      const cursor = page.cursor ? decodeCursor(page.cursor) : null;
      const conditions: string[] = [];
      const params: unknown[] = [];
      let p = 1;

      if (filter?.status?.length) {
        conditions.push(`j.status = ANY($${p}::${schema}.${tablePrefix}job_status[])`);
        params.push(filter.status);
        p++;
      }
      if (filter?.typeName?.length) {
        conditions.push(`j.type_name = ANY($${p}::text[])`);
        params.push(filter.typeName);
        p++;
      }
      if (filter?.chainId) {
        conditions.push(`j.chain_id = $${p}::${idType}`);
        params.push(filter.chainId);
        p++;
      }
      if (filter?.id) {
        conditions.push(`(j.id = $${p}::${idType} OR j.chain_id = $${p}::${idType})`);
        params.push(filter.id);
        p++;
      }
      if (cursor) {
        conditions.push(
          `(j.created_at < $${p}::timestamptz OR (j.created_at = $${p}::timestamptz AND j.id < $${p + 1}::${idType}))`,
        );
        params.push(cursor.createdAt, cursor.id);
        p += 2;
      }
      params.push(page.limit + 1);

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sqlStr = `SELECT * FROM ${schema}.${tablePrefix}job j ${where} ORDER BY j.created_at DESC, j.id DESC LIMIT $${p}`;

      const rows = (await stateProvider.executeSql({
        txCtx,
        sql: sqlStr,
        params,
      })) as DbJob[];

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const items = pageRows.map(mapDbJobToStateJob);

      const lastRow = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        nextCursor = encodeCursor({
          id: lastRow.id,
          createdAt: new Date(lastRow.created_at).toISOString(),
        });
      }

      return { items, nextCursor };
    },

    getJobsBlockedByChain: async ({ txCtx, chainId }) => {
      const jobs = await executeTypedSql({
        txCtx,
        sql: getJobsBlockedByChainSql,
        params: [chainId],
      });
      return jobs.map(mapDbJobToStateJob);
    },
  };

  return {
    ...rawAdapter,
    migrateToLatest: async () => {
      const runMigrations = await executeMigrations<TTxContext>({
        migrations,
        getAppliedMigrationNames: async (txCtx) => {
          await stateProvider.executeSql({
            txCtx,
            sql: applyTemplate(createMigrationTableSql).sql,
          });
          const applied = (await stateProvider.executeSql({
            txCtx,
            sql: applyTemplate(getAppliedMigrationsSql).sql,
          })) as { name: string }[];
          return applied.map((m) => m.name);
        },
        executeMigrationStatements: async (txCtx, migration) => {
          for (const stmt of migration.statements) {
            await stateProvider.executeSql({
              txCtx,
              sql: applyTemplate(stmt.sql).sql,
            });
          }
        },
        recordMigration: async (txCtx, name) => {
          await stateProvider.executeSql({
            txCtx,
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
