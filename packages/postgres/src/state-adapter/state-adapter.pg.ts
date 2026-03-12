import {
  type MigrationResult,
  type NamedParameter,
  type TypedSql,
  type UnwrapNamedParameters,
  createTemplateApplier,
  executeMigrations,
} from "@queuert/typed-sql";
import { type UUID } from "node:crypto";
import { BlockerReferenceError, type StateAdapter } from "queuert";
import {
  type BaseTxContext,
  type StateJob,
  decodeChainIndexCursor,
  decodeCreatedAtCursor,
  encodeCursor,
} from "queuert/internal";
import { type PgStateProvider } from "../state-provider/state-provider.pg.js";
import {
  type DbJob,
  acquireJobSql,
  addJobsBlockersSql,
  checkExternalBlockerRefsSql,
  completeJobSql,
  createJobsSql,
  createMigrationTableSql,
  deleteJobChainsSql,
  getAppliedMigrationsSql,
  getConnectedChainIdsSql,
  getJobBlockersSql,
  getJobByIdSql,
  getJobChainByIdSql,
  getJobForUpdateSql,
  getLatestChainJobForUpdateSql,
  getNextJobAvailableInMsSql,
  migrations,
  reapExpiredJobLeaseSql,
  recordMigrationSql,
  renewJobLeaseSql,
  rescheduleJobSql,
  unblockJobsSql,
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

    chainTraceContext: dbJob.chain_trace_context,
    traceContext: dbJob.trace_context,
  };
};

/** Create a state adapter backed by PostgreSQL. Returns the adapter with a `migrateToLatest()` method for schema migrations. */
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

    withSavepoint: async ({ txCtx, fn }) => {
      await stateProvider.executeSql({ txCtx, sql: "SAVEPOINT queuert_user_cb" });
      try {
        const result = await fn(txCtx);
        await stateProvider.executeSql({ txCtx, sql: "RELEASE SAVEPOINT queuert_user_cb" });
        return result;
      } catch (error) {
        await stateProvider
          .executeSql({ txCtx, sql: "ROLLBACK TO SAVEPOINT queuert_user_cb" })
          .catch(() => {});
        throw error;
      }
    },

    getJobChainById: async ({ txCtx, chainId }) => {
      const [jobChain] = await executeTypedSql({
        txCtx,
        sql: getJobChainByIdSql,
        params: [chainId],
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

    createJobs: async ({ txCtx, jobs }) => {
      if (jobs.length === 0) return [];

      const results = await executeTypedSql({
        txCtx,
        sql: createJobsSql,
        params: [
          jobs.length,
          jobs.map((j) => j.typeName),
          jobs.map((j) => j.chainId ?? null),
          jobs.map((j) => j.chainTypeName),
          jobs.map((j) => j.chainIndex),
          jobs.map((j) => j.input),
          jobs.map((j) => j.deduplication?.key ?? null),
          jobs.map((j) => (j.deduplication ? (j.deduplication.scope ?? "incomplete") : null)),
          jobs.map((j) => j.deduplication?.windowMs ?? null),
          jobs.map((j) => j.schedule?.at?.toISOString() ?? null),
          jobs.map((j) => j.schedule?.afterMs ?? null),
          jobs.map((j) => j.chainTraceContext ?? null),
          jobs.map((j) => j.traceContext ?? null),
        ],
      });

      return results.map((r) => ({
        job: mapDbJobToStateJob(r),
        deduplicated: r.deduplicated,
      }));
    },

    addJobsBlockers: async ({ txCtx, jobBlockers }) => {
      if (jobBlockers.length === 0) return [];

      const flatJobIds: string[] = [];
      const flatBlockedByChainIds: string[] = [];
      const flatTraceContexts: (string | null)[] = [];
      const flatIndexes: number[] = [];

      for (const entry of jobBlockers) {
        entry.blockedByChainIds.forEach((chainId, i) => {
          flatJobIds.push(entry.jobId);
          flatBlockedByChainIds.push(chainId);
          flatTraceContexts.push(entry.blockerTraceContexts?.[i] ?? null);
          flatIndexes.push(i);
        });
      }

      const results = await executeTypedSql({
        txCtx,
        sql: addJobsBlockersSql,
        params: [flatJobIds, flatBlockedByChainIds, flatTraceContexts, flatIndexes],
      });

      const resultMap = new Map(
        results.map((r) => [
          r.source_job_id,
          {
            job: mapDbJobToStateJob(r),
            incompleteBlockerChainIds: r.incomplete_blocker_chain_ids,
            blockerChainTraceContexts: r.blocker_chain_trace_contexts,
          },
        ]),
      );

      return jobBlockers.map((entry) => {
        const result = resultMap.get(entry.jobId);
        if (!result) throw new Error(`Missing blocker result for job ${entry.jobId}`);
        return result;
      });
    },

    unblockJobs: async ({ txCtx, blockedByChainId }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: unblockJobsSql,
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
    reapExpiredJobLease: async ({ txCtx, typeNames, ignoredJobIds }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: reapExpiredJobLeaseSql,
        params: [typeNames, ignoredJobIds ?? []],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
    deleteJobChains: async ({ txCtx, chainIds, cascade }) => {
      let effectiveChainIds = chainIds;
      if (cascade) {
        const connected = await executeTypedSql({
          txCtx,
          sql: getConnectedChainIdsSql,
          params: [chainIds],
        });
        effectiveChainIds = connected.map((r) => r.chain_id) as typeof chainIds;
      }
      const refs = await executeTypedSql({
        txCtx,
        sql: checkExternalBlockerRefsSql,
        params: [effectiveChainIds, effectiveChainIds],
      });
      if (refs.length > 0) {
        throw new BlockerReferenceError(
          `Cannot delete chains: ${[...new Set(refs.map((r) => r.blocked_by_chain_id))].join(", ")} referenced as blockers`,
          {
            references: refs.map((r) => ({
              chainId: r.blocked_by_chain_id,
              referencedByJobId: r.job_id,
            })),
          },
        );
      }
      const rows = await executeTypedSql({
        txCtx,
        sql: deleteJobChainsSql,
        params: [effectiveChainIds],
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
    getLatestChainJobForUpdate: async ({ txCtx, chainId }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: getLatestChainJobForUpdateSql,
        params: [chainId],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },

    listJobChains: async ({ txCtx, filter, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtCursor(page.cursor) : null;
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
      if (filter?.chainId?.length) {
        conditions.push(`root_job.chain_id = ANY($${p}::${idType}[])`);
        params.push(filter.chainId);
        p++;
      }
      if (filter?.jobId?.length) {
        conditions.push(
          `root_job.chain_id IN (SELECT chain_id FROM ${schema}.${tablePrefix}job WHERE id = ANY($${p}::${idType}[]))`,
        );
        params.push(filter.jobId);
        p++;
      }
      if (filter?.status?.length) {
        conditions.push(`last_job.status = ANY($${p}::${schema}.${tablePrefix}job_status[])`);
        params.push(filter.status);
        p++;
      }
      if (filter?.from) {
        conditions.push(`root_job.created_at >= $${p}::timestamptz`);
        params.push(filter.from);
        p++;
      }
      if (filter?.to) {
        conditions.push(`root_job.created_at <= $${p}::timestamptz`);
        params.push(filter.to);
        p++;
      }
      const cmp = orderDirection === "desc" ? "<" : ">";
      if (cursor) {
        conditions.push(
          `(root_job.created_at ${cmp} $${p}::timestamptz OR (root_job.created_at = $${p}::timestamptz AND root_job.id ${cmp} $${p + 1}::${idType}))`,
        );
        params.push(cursor.createdAt, cursor.id);
        p += 2;
      }
      params.push(page.limit + 1);

      const dir = orderDirection === "desc" ? "DESC" : "ASC";
      const sqlStr = `SELECT row_to_json(root_job) AS root_job, row_to_json(last_job) AS last_chain_job FROM ${schema}.${tablePrefix}job root_job LEFT JOIN LATERAL (SELECT * FROM ${schema}.${tablePrefix}job WHERE chain_id = root_job.id ORDER BY chain_index DESC LIMIT 1) last_job ON TRUE WHERE ${conditions.join(" AND ")} ORDER BY root_job.created_at ${dir}, root_job.id ${dir} LIMIT $${p}`;

      const rows = (await stateProvider.executeSql({
        txCtx,
        sql: sqlStr,
        params,
      })) as { root_job: DbJob; last_chain_job: DbJob | null }[];

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
          type: "createdAt",
          id: lastItem.root_job.id,
          createdAt: lastItem.root_job.created_at,
        });
      }

      return { items, nextCursor };
    },

    listJobs: async ({ txCtx, filter, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtCursor(page.cursor) : null;
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
      if (filter?.chainId?.length) {
        conditions.push(`j.chain_id = ANY($${p}::${idType}[])`);
        params.push(filter.chainId);
        p++;
      }
      if (filter?.jobId?.length) {
        conditions.push(`j.id = ANY($${p}::${idType}[])`);
        params.push(filter.jobId);
        p++;
      }
      if (filter?.from) {
        conditions.push(`j.created_at >= $${p}::timestamptz`);
        params.push(filter.from);
        p++;
      }
      if (filter?.to) {
        conditions.push(`j.created_at <= $${p}::timestamptz`);
        params.push(filter.to);
        p++;
      }
      const cmp = orderDirection === "desc" ? "<" : ">";
      if (cursor) {
        conditions.push(
          `(j.created_at ${cmp} $${p}::timestamptz OR (j.created_at = $${p}::timestamptz AND j.id ${cmp} $${p + 1}::${idType}))`,
        );
        params.push(cursor.createdAt, cursor.id);
        p += 2;
      }
      params.push(page.limit + 1);

      const dir = orderDirection === "desc" ? "DESC" : "ASC";
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sqlStr = `SELECT * FROM ${schema}.${tablePrefix}job j ${where} ORDER BY j.created_at ${dir}, j.id ${dir} LIMIT $${p}`;

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
          type: "createdAt",
          id: lastRow.id,
          createdAt: lastRow.created_at,
        });
      }

      return { items, nextCursor };
    },

    listJobChainJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeChainIndexCursor(page.cursor) : null;
      const conditions: string[] = [`j.chain_id = $1::${idType}`];
      const params: unknown[] = [chainId];
      let p = 2;

      const cmp = orderDirection === "asc" ? ">" : "<";
      if (cursor) {
        conditions.push(
          `(j.chain_index ${cmp} $${p}::integer OR (j.chain_index = $${p}::integer AND j.id ${cmp} $${p + 1}::${idType}))`,
        );
        params.push(cursor.chainIndex, cursor.id);
        p += 2;
      }
      params.push(page.limit + 1);

      const dir = orderDirection === "asc" ? "ASC" : "DESC";
      const sqlStr = `SELECT * FROM ${schema}.${tablePrefix}job j WHERE ${conditions.join(" AND ")} ORDER BY j.chain_index ${dir}, j.id ${dir} LIMIT $${p}`;

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
          type: "chainIndex",
          id: lastRow.id,
          chainIndex: lastRow.chain_index,
        });
      }

      return { items, nextCursor };
    },

    listBlockedJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtCursor(page.cursor) : null;
      const conditions: string[] = [
        `j.id IN (SELECT jb.job_id FROM ${schema}.${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = $1::${idType})`,
      ];
      const params: unknown[] = [chainId];
      let p = 2;

      const cmp = orderDirection === "desc" ? "<" : ">";
      if (cursor) {
        conditions.push(
          `(j.created_at ${cmp} $${p}::timestamptz OR (j.created_at = $${p}::timestamptz AND j.id ${cmp} $${p + 1}::${idType}))`,
        );
        params.push(cursor.createdAt, cursor.id);
        p += 2;
      }
      params.push(page.limit + 1);

      const dir = orderDirection === "desc" ? "DESC" : "ASC";
      const sqlStr = `SELECT * FROM ${schema}.${tablePrefix}job j WHERE ${conditions.join(" AND ")} ORDER BY j.created_at ${dir}, j.id ${dir} LIMIT $${p}`;

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
          type: "createdAt",
          id: lastRow.id,
          createdAt: lastRow.created_at,
        });
      }

      return { items, nextCursor };
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

/** PostgreSQL state adapter type. Includes `migrateToLatest` for schema migrations. */
export type PgStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string = string,
> = StateAdapter<TTxContext, TJobId> & {
  migrateToLatest: () => Promise<MigrationResult>;
};
