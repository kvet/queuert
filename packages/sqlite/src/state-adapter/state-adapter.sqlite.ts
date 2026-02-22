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
import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";
import {
  type DbJob,
  type DbJobChainRow,
  acquireJobSql,
  checkBlockersStatusSql,
  checkExternalBlockerRefsSql,
  completeJobSql,
  createMigrationTableSql,
  deleteBlockersByChainIdsSql,
  deleteJobsByChainIdsSql,
  findDeduplicatedJobSql,
  findExistingContinuationSql,
  findReadyJobsSql,
  getAppliedMigrationsSql,
  getBlockerChainTraceContextsSql,
  getCurrentJobForUpdateSql,
  getJobBlockerTraceContextsSql,
  getJobBlockersSql,
  getJobByIdForBlockersSql,
  getJobByIdSql,
  getJobChainByIdSql,
  getJobChainsByChainIdsSql,
  getJobForUpdateSql,
  getJobsBlockedByChainSql,
  getNextJobAvailableInMsSql,
  insertJobBlockersSql,
  insertJobSql,
  jobColumnsPrefixedSelect,
  jobColumnsSelect,
  migrations,
  recordMigrationSql,
  removeExpiredJobLeaseSql,
  renewJobLeaseSql,
  rescheduleJobSql,
  scheduleBlockedJobSql,
  updateJobToBlockedSql,
} from "./sql.js";

const isoToSqlite = (iso: string): string => iso.replace("T", " ").replace("Z", "");

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
    chainIndex: dbJob.chain_index,
    input: parseJson(dbJob.input),
    output: parseJson(dbJob.output),

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

    traceContext: parseJson(dbJob.trace_context),
  };
};

const parseDbJobChainRow = (row: DbJobChainRow): { rootJob: DbJob; lastChainJob: DbJob | null } => {
  const rootJob: DbJob = {
    id: row.id,
    type_name: row.type_name,
    chain_id: row.chain_id,
    chain_type_name: row.chain_type_name,
    chain_index: row.chain_index,
    input: row.input,
    output: row.output,
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
    trace_context: row.trace_context,
  };

  const lastChainJob: DbJob | null = row.lc_id
    ? {
        id: row.lc_id,
        type_name: row.lc_type_name!,
        chain_id: row.lc_chain_id!,
        chain_type_name: row.lc_chain_type_name!,
        chain_index: row.lc_chain_index!,
        input: row.lc_input,
        output: row.lc_output,
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
        trace_context: row.lc_trace_context,
      }
    : null;

  return { rootJob, lastChainJob };
};

export const createSqliteStateAdapter = async <
  TTxContext extends BaseTxContext,
  TIdType extends string = UUID,
>({
  stateProvider,
  tablePrefix = "queuert_",
  idType = "TEXT",
  idGenerator = () => crypto.randomUUID() as TIdType,
}: {
  stateProvider: SqliteStateProvider<TTxContext>;
  tablePrefix?: string;
  idType?: string;
  idGenerator?: () => TIdType;
}): Promise<
  StateAdapter<TTxContext, TIdType> & {
    migrateToLatest: () => Promise<MigrationResult>;
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
      chainIndex,
      input,
      chainId,
      deduplication,
      schedule,
      traceContext,
    }) => {
      const newId = idGenerator();
      const inputJson = input !== undefined ? JSON.stringify(input) : null;
      const deduplicationKey = deduplication?.key ?? null;
      const deduplicationScope = deduplication ? (deduplication.scope ?? "incomplete") : null;
      const deduplicationWindowMs = deduplication?.windowMs ?? null;

      const chainIdOrNull = chainId ?? null;
      const scheduledAtIso = schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null;
      const scheduleAfterMsOrNull = schedule?.afterMs ?? null;
      const traceContextJson = traceContext !== undefined ? JSON.stringify(traceContext) : null;

      if (chainId) {
        const [existingContinuation] = await executeTypedSql({
          txContext,
          sql: findExistingContinuationSql,
          params: [chainId, chainIndex],
        });

        if (existingContinuation) {
          return { job: mapDbJobToStateJob(existingContinuation), deduplicated: true };
        }
      } else if (deduplicationKey) {
        const [existingDeduplicated] = await executeTypedSql({
          txContext,
          sql: findDeduplicatedJobSql,
          params: [
            deduplicationKey,
            deduplicationKey,
            chainTypeName,
            deduplicationScope,
            deduplicationScope,
            deduplicationScope,
            deduplicationWindowMs,
            deduplicationWindowMs,
          ],
        });

        if (existingDeduplicated) {
          return { job: mapDbJobToStateJob(existingDeduplicated), deduplicated: true };
        }
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
          chainIndex,
          inputJson,
          deduplicationKey,
          scheduledAtIso,
          scheduleAfterMsOrNull,
          scheduleAfterMsOrNull,
          traceContextJson,
        ],
      });

      return { job: mapDbJobToStateJob(result), deduplicated: result.id !== newId };
    },

    addJobBlockers: async ({ txContext, jobId, blockedByChainIds, blockerTraceContexts }) => {
      const traceContextsJson = JSON.stringify(
        (blockerTraceContexts ?? []).map((tc) => (tc != null ? JSON.stringify(tc) : null)),
      );

      await executeTypedSql({
        txContext,
        sql: insertJobBlockersSql,
        params: [jobId, traceContextsJson, JSON.stringify(blockedByChainIds)],
      });

      const blockerStatuses = await executeTypedSql({
        txContext,
        sql: checkBlockersStatusSql,
        params: [jobId],
      });

      const chainTraceContextRows = await executeTypedSql({
        txContext,
        sql: getBlockerChainTraceContextsSql,
        params: [JSON.stringify(blockedByChainIds)],
      });

      const chainTraceContextMap = new Map(
        chainTraceContextRows.map((r) => [
          r.blocked_by_chain_id,
          r.trace_context ? JSON.parse(r.trace_context) : null,
        ]),
      );
      const blockerChainTraceContexts = blockedByChainIds.map(
        (id) => chainTraceContextMap.get(id) ?? null,
      );

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
          return {
            job: mapDbJobToStateJob(updatedJob),
            incompleteBlockerChainIds,
            blockerChainTraceContexts,
          };
        }
      }

      const [job] = await executeTypedSql({
        txContext,
        sql: getJobByIdForBlockersSql,
        params: [jobId],
      });
      return {
        job: mapDbJobToStateJob(job),
        incompleteBlockerChainIds: [],
        blockerChainTraceContexts,
      };
    },
    scheduleBlockedJobs: async ({ txContext, blockedByChainId }) => {
      const readyJobs = await executeTypedSql({
        txContext,
        sql: findReadyJobsSql,
        params: [blockedByChainId],
      });

      const unblockedJobs: StateJob[] = [];
      for (const { job_id } of readyJobs) {
        const [job] = await executeTypedSql({
          txContext,
          sql: scheduleBlockedJobSql,
          params: [job_id],
        });
        if (job) {
          unblockedJobs.push(mapDbJobToStateJob(job));
        }
      }

      const traceContextResults = await executeTypedSql({
        txContext,
        sql: getJobBlockerTraceContextsSql,
        params: [blockedByChainId],
      });
      const blockerTraceContexts = traceContextResults.map((r) =>
        r.trace_context ? JSON.parse(r.trace_context) : null,
      );

      return { unblockedJobs, blockerTraceContexts };
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
      const [result] = await executeTypedSql({
        txContext,
        sql: acquireJobSql,
        params: [typeNamesJson, typeNamesJson],
      });

      return result
        ? { job: mapDbJobToStateJob(result), hasMore: result.has_more === 1 }
        : { job: undefined, hasMore: false };
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
    removeExpiredJobLease: async ({ txContext, typeNames, ignoredJobIds }) => {
      const [job] = await executeTypedSql({
        txContext,
        sql: removeExpiredJobLeaseSql,
        params: [JSON.stringify(typeNames), JSON.stringify(ignoredJobIds ?? [])],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
    deleteJobsByChainIds: async ({ txContext, chainIds }) => {
      const chainIdsJson = JSON.stringify(chainIds);
      const refs = await executeTypedSql({
        txContext,
        sql: checkExternalBlockerRefsSql,
        params: [chainIdsJson, chainIdsJson],
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
        txContext,
        sql: getJobChainsByChainIdsSql,
        params: [chainIdsJson],
      });
      await executeTypedSql({
        txContext,
        sql: deleteBlockersByChainIdsSql,
        params: [chainIdsJson],
      });
      await executeTypedSql({
        txContext,
        sql: deleteJobsByChainIdsSql,
        params: [chainIdsJson],
      });
      return rows.map((row) => {
        const { rootJob, lastChainJob } = parseDbJobChainRow(row);
        return [
          mapDbJobToStateJob(rootJob),
          lastChainJob && lastChainJob.id !== rootJob.id
            ? mapDbJobToStateJob(lastChainJob)
            : undefined,
        ] as [StateJob, StateJob | undefined];
      });
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

    listChains: async ({ txContext, filter, page }) => {
      const cursor = page.cursor ? decodeCursor(page.cursor) : null;
      const conditions: string[] = ["j.chain_index = 0"];
      const params: unknown[] = [];

      if (filter?.typeName?.length) {
        conditions.push("j.type_name IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.typeName));
      }
      if (filter?.rootOnly) {
        conditions.push(
          `NOT EXISTS (SELECT 1 FROM ${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = j.chain_id)`,
        );
      }
      if (filter?.id) {
        conditions.push(
          `(j.chain_id = ? OR j.chain_id IN (SELECT chain_id FROM ${tablePrefix}job WHERE id = ?))`,
        );
        params.push(filter.id, filter.id);
      }
      if (cursor) {
        conditions.push("(j.created_at < ? OR (j.created_at = ? AND j.id < ?))");
        const cursorCreatedAt = isoToSqlite(cursor.createdAt);
        params.push(cursorCreatedAt, cursorCreatedAt, cursor.id);
      }
      params.push(page.limit + 1);

      const sqlStr = `SELECT ${jobColumnsSelect("j")}, ${jobColumnsPrefixedSelect("lc", "lc_")} FROM ${tablePrefix}job AS j LEFT JOIN ${tablePrefix}job AS lc ON lc.chain_id = j.id AND lc.rowid = (SELECT lj.rowid FROM ${tablePrefix}job lj WHERE lj.chain_id = j.id ORDER BY lj.created_at DESC, lj.rowid DESC LIMIT 1) WHERE ${conditions.join(" AND ")} ORDER BY j.created_at DESC, j.id DESC LIMIT ?`;

      const rows = (await stateProvider.executeSql({
        txContext,
        sql: sqlStr,
        params,
        returns: true,
      })) as DbJobChainRow[];

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;

      const items: [StateJob, StateJob | undefined][] = pageRows.map((row) => {
        const { rootJob, lastChainJob } = parseDbJobChainRow(row);
        return [
          mapDbJobToStateJob(rootJob),
          lastChainJob && lastChainJob.id !== rootJob.id
            ? mapDbJobToStateJob(lastChainJob)
            : undefined,
        ];
      });

      const lastRow = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        const { rootJob } = parseDbJobChainRow(lastRow);
        nextCursor = encodeCursor({
          id: rootJob.id,
          createdAt: new Date(rootJob.created_at + "Z").toISOString(),
        });
      }

      return { items, nextCursor };
    },

    listJobs: async ({ txContext, filter, page }) => {
      const cursor = page.cursor ? decodeCursor(page.cursor) : null;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filter?.status?.length) {
        conditions.push("j.status IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.status));
      }
      if (filter?.typeName?.length) {
        conditions.push("j.type_name IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.typeName));
      }
      if (filter?.chainId) {
        conditions.push("j.chain_id = ?");
        params.push(filter.chainId);
      }
      if (filter?.id) {
        conditions.push("(j.id = ? OR j.chain_id = ?)");
        params.push(filter.id, filter.id);
      }
      if (cursor) {
        conditions.push("(j.created_at < ? OR (j.created_at = ? AND j.id < ?))");
        const cursorCreatedAt = isoToSqlite(cursor.createdAt);
        params.push(cursorCreatedAt, cursorCreatedAt, cursor.id);
      }
      params.push(page.limit + 1);

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sqlStr = `SELECT * FROM ${tablePrefix}job j ${where} ORDER BY j.created_at DESC, j.id DESC LIMIT ?`;

      const rows = (await stateProvider.executeSql({
        txContext,
        sql: sqlStr,
        params,
        returns: true,
      })) as DbJob[];

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const items = pageRows.map(mapDbJobToStateJob);

      const lastRow = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        nextCursor = encodeCursor({
          id: lastRow.id,
          createdAt: new Date(lastRow.created_at + "Z").toISOString(),
        });
      }

      return { items, nextCursor };
    },

    getJobsBlockedByChain: async ({ txContext, chainId }) => {
      const jobs = await executeTypedSql({
        txContext,
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
        getAppliedMigrationNames: async (txContext) => {
          await stateProvider.executeSql({
            txContext,
            sql: applyTemplate(createMigrationTableSql).sql,
            returns: false,
          });
          const applied = (await stateProvider.executeSql({
            txContext,
            sql: applyTemplate(getAppliedMigrationsSql).sql,
            returns: true,
          })) as { name: string }[];
          return applied.map((m) => m.name);
        },
        executeMigrationStatements: async (txContext, migration) => {
          for (const stmt of migration.statements) {
            await stateProvider.executeSql({
              txContext,
              sql: applyTemplate(stmt.sql).sql,
              returns: false,
            });
          }
        },
        recordMigration: async (txContext, name) => {
          await stateProvider.executeSql({
            txContext,
            sql: applyTemplate(recordMigrationSql).sql,
            params: [name],
            returns: false,
          });
        },
      });

      return stateProvider.runInTransaction(runMigrations);
    },
  };
};

export type SqliteStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string,
> = StateAdapter<TTxContext, TJobId>;
