import { randomUUID, type UUID } from "node:crypto";

import {
  type DataType,
  type InferColumns,
  type InferParams,
  type MigrationResult,
  type TypedSql,
  createTemplateApplier,
  executeMigrations,
  extractColumnTypes,
  t,
} from "@queuert/typed-sql";
import { BlockerReferenceError, type StateAdapter } from "queuert";
import {
  type BaseTxContext,
  type StateJob,
  decodeChainIndexCursor,
  decodeCreatedAtCursor,
  encodeCursor,
} from "queuert/internal";

import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";
import {
  type DbJob,
  type DbJobChainRow,
  createSqliteSqlDefinitions,
  jobColumnsPrefixedSelect,
  jobColumnsSelect,
  migrations,
} from "./sql.js";

const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const validateSqlIdentifier = (value: string, name: string): void => {
  if (!SQL_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${name}: "${value}". Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/ to prevent SQL injection.`,
    );
  }
};

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

    chainTraceContext: dbJob.chain_trace_context,
    traceContext: dbJob.trace_context,
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
    chain_trace_context: row.chain_trace_context,
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
        chain_trace_context: row.lc_chain_trace_context,
        trace_context: row.lc_trace_context,
      }
    : null;

  return { rootJob, lastChainJob };
};

/**
 * Create a state adapter backed by SQLite. Returns the adapter with a `migrateToLatest()` method for schema migrations.
 * @experimental
 */
export const createSqliteStateAdapter = async <
  TTxContext extends BaseTxContext,
  TIdType extends string = UUID,
>({
  stateProvider,
  tablePrefix = "queuert_",
  idType = "TEXT",
  idGenerator = () => crypto.randomUUID() as TIdType,
  checkForeignKeys = true,
  checkAutoVacuum = true,
}: {
  /** SQLite state provider wrapping the database connection. */
  stateProvider: SqliteStateProvider<TTxContext>;
  /** Prefix for all table names. @defaultValue `"queuert_"` */
  tablePrefix?: string;
  /** SQL type for the primary key column. @defaultValue `"TEXT"` */
  idType?: string;
  /** Function to generate new job IDs. @defaultValue `() => crypto.randomUUID()` */
  idGenerator?: () => TIdType;
  /** Whether `migrateToLatest()` verifies that `PRAGMA foreign_keys = ON` is set. Disable only if foreign keys are managed externally. @defaultValue `true` */
  checkForeignKeys?: boolean;
  /** Whether `migrateToLatest()` verifies that `PRAGMA auto_vacuum = INCREMENTAL` is set. Required for `vacuum()` to reclaim disk space. @defaultValue `true` */
  checkAutoVacuum?: boolean;
}): Promise<
  StateAdapter<TTxContext, TIdType> & {
    migrateToLatest: () => Promise<MigrationResult>;
    vacuum: () => Promise<void>;
    truncate: () => Promise<void>;
  }
> => {
  validateSqlIdentifier(tablePrefix, "tablePrefix");
  validateSqlIdentifier(idType, "idType");

  const applyTemplate = createTemplateApplier(
    { table_prefix: tablePrefix, id_type: idType },
    {
      job_columns: jobColumnsSelect,
      job_columns_prefixed: jobColumnsPrefixedSelect,
    },
  );

  const idDataType = t.string();
  const defs = createSqliteSqlDefinitions(idDataType);

  const executeTypedSql = async <
    TParams extends readonly DataType[],
    TColumns extends Record<string, DataType>,
  >({
    txCtx,
    sql: typedSql,
    params,
  }: {
    txCtx?: TTxContext;
    sql: TypedSql<TParams, TColumns>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: [...InferParams<TParams>] })): Promise<InferColumns<TColumns>[]> => {
    const resolvedSql = applyTemplate(typedSql);
    return stateProvider.executeSql({
      txCtx,
      sql: resolvedSql.sql,
      params: params!,
      columnTypes: extractColumnTypes(resolvedSql.columns),
    }) as Promise<InferColumns<TColumns>[]>;
  };

  const rawAdapter: StateAdapter<TTxContext, TIdType> = {
    withTransaction: stateProvider.withTransaction,

    withSavepoint:
      stateProvider.withSavepoint ??
      (async (txCtx, fn) => {
        const sp = `queuert_sp_${randomUUID().replace(/-/g, "_")}`;
        await stateProvider.executeSql({ txCtx, sql: `SAVEPOINT ${sp}`, columnTypes: {} });
        try {
          const result = await fn(txCtx);
          await stateProvider.executeSql({
            txCtx,
            sql: `RELEASE SAVEPOINT ${sp}`,
            columnTypes: {},
          });
          return result;
        } catch (error) {
          await stateProvider
            .executeSql({ txCtx, sql: `ROLLBACK TO SAVEPOINT ${sp}`, columnTypes: {} })
            .catch(() => {});
          throw error;
        }
      }),

    getJobChainById: async ({ txCtx, chainId }) => {
      const [row] = await executeTypedSql({
        txCtx,
        sql: defs.getJobChainByIdSql,
        params: [chainId, chainId],
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
    getJobById: async ({ txCtx, jobId }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: defs.getJobByIdSql,
        params: [jobId],
      });

      return job ? mapDbJobToStateJob(job) : undefined;
    },

    createJobs: async ({ txCtx, jobs }) => {
      const results: { job: StateJob; deduplicated: boolean }[] = Array.from({
        length: jobs.length,
      });
      const toInsert: { index: number; id: string; json: Record<string, unknown> }[] = [];
      const intraBatchDedup = new Map<string, number>();
      const deferredDupes: { index: number; firstIndex: number }[] = [];

      for (let i = 0; i < jobs.length; i++) {
        const {
          typeName,
          chainTypeName,
          chainIndex,
          input,
          chainId,
          deduplication,
          schedule,
          chainTraceContext,
          traceContext,
        } = jobs[i];
        const deduplicationKey = deduplication?.key ?? null;
        const deduplicationScope = deduplication ? (deduplication.scope ?? "incomplete") : null;
        const deduplicationWindowMs = deduplication?.windowMs ?? null;
        const deduplicationExcludeChainIds = deduplication?.excludeJobChainIds
          ? JSON.stringify(deduplication.excludeJobChainIds)
          : null;

        if (chainId) {
          const [existingContinuation] = await executeTypedSql({
            txCtx,
            sql: defs.findExistingContinuationSql,
            params: [chainId, chainIndex],
          });

          if (existingContinuation) {
            results[i] = { job: mapDbJobToStateJob(existingContinuation), deduplicated: true };
            continue;
          }
        } else if (deduplicationKey) {
          const batchKey = `${deduplicationKey}\0${chainTypeName}`;
          const firstIdx = intraBatchDedup.get(batchKey);
          if (firstIdx !== undefined) {
            deferredDupes.push({ index: i, firstIndex: firstIdx });
            continue;
          }

          const [existingDeduplicated] = await executeTypedSql({
            txCtx,
            sql: defs.findDeduplicatedJobSql,
            params: [
              deduplicationKey,
              deduplicationKey,
              chainTypeName,
              deduplicationScope,
              deduplicationScope,
              deduplicationScope,
              deduplicationWindowMs,
              deduplicationWindowMs,
              deduplicationExcludeChainIds,
              deduplicationExcludeChainIds,
            ],
          });

          if (existingDeduplicated) {
            results[i] = { job: mapDbJobToStateJob(existingDeduplicated), deduplicated: true };
            continue;
          }

          intraBatchDedup.set(batchKey, i);
        }

        const newId = idGenerator();
        toInsert.push({
          index: i,
          id: newId,
          json: {
            id: newId,
            type_name: typeName,
            chain_id: chainId ?? null,
            chain_type_name: chainTypeName,
            chain_index: chainIndex,
            input: input !== undefined ? JSON.stringify(input) : null,
            deduplication_key: deduplicationKey,
            scheduled_at: schedule?.at?.toISOString().replace("T", " ").replace("Z", "") ?? null,
            schedule_after_ms: schedule?.afterMs ?? null,
            chain_trace_context: chainTraceContext ?? null,
            trace_context: traceContext ?? null,
          },
        });
      }

      if (toInsert.length > 0) {
        const insertedRows = await executeTypedSql({
          txCtx,
          sql: defs.insertJobsSql,
          params: [JSON.stringify(toInsert.map((item) => item.json))],
        });

        for (let j = 0; j < toInsert.length; j++) {
          const row = insertedRows[j];
          results[toInsert[j].index] = {
            job: mapDbJobToStateJob(row),
            deduplicated: row.id !== toInsert[j].id,
          };
        }
      }

      for (const { index, firstIndex } of deferredDupes) {
        results[index] = { job: results[firstIndex].job, deduplicated: true };
      }

      return results;
    },

    addJobsBlockers: async ({ txCtx, jobBlockers }) => {
      const results: {
        job: StateJob;
        incompleteBlockerChainIds: string[];
        blockerChainTraceContexts: (string | null)[];
      }[] = [];

      for (const { jobId, blockedByChainIds, blockerTraceContexts } of jobBlockers) {
        const traceContextsJson = JSON.stringify(blockerTraceContexts ?? []);

        await executeTypedSql({
          txCtx,
          sql: defs.insertJobBlockersSql,
          params: [jobId, traceContextsJson, JSON.stringify(blockedByChainIds)],
        });

        const blockerStatuses = await executeTypedSql({
          txCtx,
          sql: defs.checkBlockersStatusSql,
          params: [jobId],
        });

        const chainTraceContextRows = await executeTypedSql({
          txCtx,
          sql: defs.getBlockerChainTraceContextsSql,
          params: [JSON.stringify(blockedByChainIds)],
        });

        const chainTraceContextMap = new Map(
          chainTraceContextRows.map((r) => [r.blocked_by_chain_id, r.chain_trace_context]),
        );
        const blockerChainTraceContexts = blockedByChainIds.map(
          (id) => chainTraceContextMap.get(id) ?? null,
        );

        const incompleteBlockerChainIds = blockerStatuses
          .filter((b) => b.blocker_status !== "completed")
          .map((b) => b.blocked_by_chain_id);

        if (incompleteBlockerChainIds.length > 0) {
          const [updatedJob] = await executeTypedSql({
            txCtx,
            sql: defs.updateJobToBlockedSql,
            params: [jobId],
          });
          if (updatedJob) {
            results.push({
              job: mapDbJobToStateJob(updatedJob),
              incompleteBlockerChainIds,
              blockerChainTraceContexts,
            });
            continue;
          }
        }

        const [job] = await executeTypedSql({
          txCtx,
          sql: defs.getJobByIdForBlockersSql,
          params: [jobId],
        });
        results.push({
          job: mapDbJobToStateJob(job),
          incompleteBlockerChainIds: [],
          blockerChainTraceContexts,
        });
      }

      return results;
    },

    unblockJobs: async ({ txCtx, blockedByChainId }) => {
      const readyJobs = await executeTypedSql({
        txCtx,
        sql: defs.findReadyJobsSql,
        params: [blockedByChainId],
      });

      const readyJobIds = readyJobs.map((r) => r.job_id);
      let unblockedJobs: StateJob[];
      if (readyJobIds.length > 0) {
        const updatedJobs = await executeTypedSql({
          txCtx,
          sql: defs.scheduleBlockedJobsSql,
          params: [JSON.stringify(readyJobIds)],
        });
        unblockedJobs = updatedJobs.map(mapDbJobToStateJob);
      } else {
        unblockedJobs = [];
      }

      const traceContextResults = await executeTypedSql({
        txCtx,
        sql: defs.getJobBlockerTraceContextsSql,
        params: [blockedByChainId],
      });
      const blockerTraceContexts = traceContextResults.map((r) => r.trace_context);

      return { unblockedJobs, blockerTraceContexts };
    },
    getJobBlockers: async ({ txCtx, jobId }) => {
      const rows = await executeTypedSql({
        txCtx,
        sql: defs.getJobBlockersSql,
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

    getNextJobAvailableInMs: async ({ txCtx, typeNames }) => {
      const [result] = await executeTypedSql({
        txCtx,
        sql: defs.getNextJobAvailableInMsSql,
        params: [JSON.stringify(typeNames)],
      });
      return result ? result.available_in_ms : null;
    },
    acquireJob: async ({ txCtx, typeNames }) => {
      const typeNamesJson = JSON.stringify(typeNames);
      const [result] = await executeTypedSql({
        txCtx,
        sql: defs.acquireJobSql,
        params: [typeNamesJson, typeNamesJson],
      });

      return result
        ? { job: mapDbJobToStateJob(result), hasMore: result.has_more === 1 }
        : { job: undefined, hasMore: false };
    },
    renewJobLease: async ({ txCtx, jobId, workerId, leaseDurationMs }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: defs.renewJobLeaseSql,
        params: [workerId, leaseDurationMs, jobId],
      });

      return mapDbJobToStateJob(job);
    },
    rescheduleJob: async ({ txCtx, jobId, schedule, error }) => {
      const scheduledAtIso = schedule.at?.toISOString().replace("T", " ").replace("Z", "") ?? null;
      const scheduleAfterMsOrNull = schedule.afterMs ?? null;
      const [job] = await executeTypedSql({
        txCtx,
        sql: defs.rescheduleJobSql,
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
    completeJob: async ({ txCtx, jobId, output, workerId }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: defs.completeJobSql,
        params: [workerId, output !== undefined ? JSON.stringify(output) : null, jobId],
      });

      return mapDbJobToStateJob(job);
    },
    reapExpiredJobLease: async ({ txCtx, typeNames, ignoredJobIds }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: defs.reapExpiredJobLeaseSql,
        params: [JSON.stringify(typeNames), JSON.stringify(ignoredJobIds ?? [])],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
    deleteJobChains: async ({ txCtx, chainIds, cascade }) => {
      let effectiveChainIds = chainIds;
      if (cascade) {
        const connected = await executeTypedSql({
          txCtx,
          sql: defs.getConnectedChainIdsSql,
          params: [JSON.stringify(chainIds)],
        });
        effectiveChainIds = connected.map((r) => r.chain_id) as typeof chainIds;
      }
      const chainIdsJson = JSON.stringify(effectiveChainIds);
      const refs = await executeTypedSql({
        txCtx,
        sql: defs.checkExternalBlockerRefsSql,
        params: [chainIdsJson, chainIdsJson],
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
        sql: defs.getJobChainsByChainIdsSql,
        params: [chainIdsJson],
      });
      await executeTypedSql({
        txCtx,
        sql: defs.deleteBlockersByChainIdsSql,
        params: [chainIdsJson],
      });
      await executeTypedSql({
        txCtx,
        sql: defs.deleteJobChainsSql,
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
    getJobForUpdate: async ({ txCtx, jobId }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: defs.getJobForUpdateSql,
        params: [jobId],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },
    getLatestChainJobForUpdate: async ({ txCtx, chainId }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: defs.getLatestChainJobForUpdateSql,
        params: [chainId],
      });
      return job ? mapDbJobToStateJob(job) : undefined;
    },

    listJobChains: async ({ txCtx, filter, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtCursor(page.cursor) : null;
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
      if (filter?.chainId?.length) {
        conditions.push("j.chain_id IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.chainId));
      }
      if (filter?.jobId?.length) {
        conditions.push(
          `j.chain_id IN (SELECT chain_id FROM ${tablePrefix}job WHERE id IN (SELECT value FROM json_each(?)))`,
        );
        params.push(JSON.stringify(filter.jobId));
      }
      if (filter?.status?.length) {
        conditions.push("lc.status IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.status));
      }
      if (filter?.from) {
        conditions.push("j.created_at >= ?");
        params.push(isoToSqlite(filter.from.toISOString()));
      }
      if (filter?.to) {
        conditions.push("j.created_at <= ?");
        params.push(isoToSqlite(filter.to.toISOString()));
      }
      if (cursor) {
        const cursorCreatedAt = isoToSqlite(cursor.createdAt);
        if (orderDirection === "desc") {
          conditions.push("(j.created_at < ? OR (j.created_at = ? AND j.id < ?))");
        } else {
          conditions.push("(j.created_at > ? OR (j.created_at = ? AND j.id > ?))");
        }
        params.push(cursorCreatedAt, cursorCreatedAt, cursor.id);
      }
      params.push(page.limit + 1);

      const orderDir = orderDirection === "desc" ? "DESC" : "ASC";
      const sqlStr = `SELECT ${jobColumnsSelect("j")}, ${jobColumnsPrefixedSelect("lc", "lc_")} FROM ${tablePrefix}job AS j LEFT JOIN ${tablePrefix}job AS lc ON lc.chain_id = j.id AND lc.rowid = (SELECT lj.rowid FROM ${tablePrefix}job lj WHERE lj.chain_id = j.id ORDER BY lj.chain_index DESC LIMIT 1) WHERE ${conditions.join(" AND ")} ORDER BY j.created_at ${orderDir}, j.id ${orderDir} LIMIT ?`;

      const rows = (await stateProvider.executeSql({
        txCtx,
        sql: sqlStr,
        params,
        columnTypes: extractColumnTypes(defs.dbJobChainRowColumns),
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
          type: "createdAt",
          id: rootJob.id,
          createdAt: new Date(rootJob.created_at + "Z").toISOString(),
        });
      }

      return { items, nextCursor };
    },

    listJobs: async ({ txCtx, filter, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtCursor(page.cursor) : null;
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
      if (filter?.chainTypeName?.length) {
        conditions.push("j.chain_type_name IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.chainTypeName));
      }
      if (filter?.chainId?.length) {
        conditions.push("j.chain_id IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.chainId));
      }
      if (filter?.jobId?.length) {
        conditions.push("j.id IN (SELECT value FROM json_each(?))");
        params.push(JSON.stringify(filter.jobId));
      }
      if (filter?.from) {
        conditions.push("j.created_at >= ?");
        params.push(isoToSqlite(filter.from.toISOString()));
      }
      if (filter?.to) {
        conditions.push("j.created_at <= ?");
        params.push(isoToSqlite(filter.to.toISOString()));
      }
      if (cursor) {
        const cursorCreatedAt = isoToSqlite(cursor.createdAt);
        if (orderDirection === "desc") {
          conditions.push("(j.created_at < ? OR (j.created_at = ? AND j.id < ?))");
        } else {
          conditions.push("(j.created_at > ? OR (j.created_at = ? AND j.id > ?))");
        }
        params.push(cursorCreatedAt, cursorCreatedAt, cursor.id);
      }
      params.push(page.limit + 1);

      const orderDir = orderDirection === "desc" ? "DESC" : "ASC";
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sqlStr = `SELECT * FROM ${tablePrefix}job j ${where} ORDER BY j.created_at ${orderDir}, j.id ${orderDir} LIMIT ?`;

      const rows = (await stateProvider.executeSql({
        txCtx,
        sql: sqlStr,
        params,
        columnTypes: extractColumnTypes(defs.dbJobColumns),
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
          createdAt: new Date(lastRow.created_at + "Z").toISOString(),
        });
      }

      return { items, nextCursor };
    },

    listJobChainJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeChainIndexCursor(page.cursor) : null;
      const conditions: string[] = ["j.chain_id = ?"];
      const params: unknown[] = [chainId];

      if (cursor) {
        if (orderDirection === "asc") {
          conditions.push("(j.chain_index > ? OR (j.chain_index = ? AND j.id > ?))");
        } else {
          conditions.push("(j.chain_index < ? OR (j.chain_index = ? AND j.id < ?))");
        }
        params.push(cursor.chainIndex, cursor.chainIndex, cursor.id);
      }
      params.push(page.limit + 1);

      const orderDir = orderDirection === "asc" ? "ASC" : "DESC";
      const sqlStr = `SELECT * FROM ${tablePrefix}job j WHERE ${conditions.join(" AND ")} ORDER BY j.chain_index ${orderDir}, j.id ${orderDir} LIMIT ?`;

      const rows = (await stateProvider.executeSql({
        txCtx,
        sql: sqlStr,
        params,
        columnTypes: extractColumnTypes(defs.dbJobColumns),
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

    triggerJob: async ({ txCtx, jobId }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: defs.triggerJobSql,
        params: [jobId],
      });
      return mapDbJobToStateJob(job);
    },

    listBlockedJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtCursor(page.cursor) : null;
      const conditions: string[] = [
        `j.id IN (SELECT jb.job_id FROM ${tablePrefix}job_blocker jb WHERE jb.blocked_by_chain_id = ?)`,
      ];
      const params: unknown[] = [chainId];

      if (cursor) {
        const cursorCreatedAt = isoToSqlite(cursor.createdAt);
        if (orderDirection === "desc") {
          conditions.push("(j.created_at < ? OR (j.created_at = ? AND j.id < ?))");
        } else {
          conditions.push("(j.created_at > ? OR (j.created_at = ? AND j.id > ?))");
        }
        params.push(cursorCreatedAt, cursorCreatedAt, cursor.id);
      }
      params.push(page.limit + 1);

      const orderDir = orderDirection === "desc" ? "DESC" : "ASC";
      const sqlStr = `SELECT * FROM ${tablePrefix}job j WHERE ${conditions.join(" AND ")} ORDER BY j.created_at ${orderDir}, j.id ${orderDir} LIMIT ?`;

      const rows = (await stateProvider.executeSql({
        txCtx,
        sql: sqlStr,
        params,
        columnTypes: extractColumnTypes(defs.dbJobColumns),
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
          createdAt: new Date(lastRow.created_at + "Z").toISOString(),
        });
      }

      return { items, nextCursor };
    },
  };

  return {
    ...rawAdapter,
    migrateToLatest: async () => {
      if (checkForeignKeys) {
        await stateProvider.withTransaction(async (txCtx) => {
          const [fkResult] = (await stateProvider.executeSql({
            txCtx,
            sql: "PRAGMA foreign_keys",
            columnTypes: { foreign_keys: "number" },
          })) as { foreign_keys: number }[];
          if (!fkResult || fkResult.foreign_keys !== 1) {
            throw new Error(
              "SQLite foreign_keys pragma is not enabled. " +
                "Enable it with PRAGMA foreign_keys = ON before using the adapter. " +
                "Foreign key enforcement is required for blocker relationship integrity.",
            );
          }
        });
      }

      if (checkAutoVacuum) {
        const [avResult] = (await stateProvider.executeSql({
          sql: "PRAGMA auto_vacuum",
          columnTypes: { auto_vacuum: "number" },
        })) as { auto_vacuum: number }[];
        if (!avResult || avResult.auto_vacuum !== 2) {
          throw new Error(
            "SQLite auto_vacuum pragma is not set to INCREMENTAL. " +
              "Enable it with PRAGMA auto_vacuum = INCREMENTAL before creating tables. " +
              "Incremental auto-vacuum is required for vacuum() to reclaim disk space.",
          );
        }
      }

      const runMigrations = await executeMigrations<TTxContext>({
        migrations,
        getAppliedMigrationNames: async (txCtx) => {
          await stateProvider.executeSql({
            txCtx,
            sql: applyTemplate(defs.createMigrationTableSql).sql,
            columnTypes: {},
          });
          const applied = (await stateProvider.executeSql({
            txCtx,
            sql: applyTemplate(defs.getAppliedMigrationsSql).sql,
            columnTypes: { name: "string", applied_at: "string" },
          })) as { name: string }[];
          return applied.map((m) => m.name);
        },
        executeMigrationStatements: async (txCtx, migration) => {
          for (const stmt of migration.statements) {
            await stateProvider.executeSql({
              txCtx,
              sql: applyTemplate(stmt.sql).sql,
              columnTypes: {},
            });
          }
        },
        recordMigration: async (txCtx, name) => {
          await stateProvider.executeSql({
            txCtx,
            sql: applyTemplate(defs.recordMigrationSql).sql,
            params: [name],
            columnTypes: {},
          });
        },
      });

      return stateProvider.withTransaction(runMigrations);
    },
    vacuum: async () => {
      await stateProvider.executeSql({ sql: "PRAGMA incremental_vacuum", columnTypes: {} });
    },
    truncate: async () => {
      await stateProvider.executeSql({
        sql: `DELETE FROM ${tablePrefix}job_blocker`,
        columnTypes: {},
      });
      await stateProvider.executeSql({
        sql: `DELETE FROM ${tablePrefix}job`,
        columnTypes: {},
      });
    },
  };
};

/**
 * SQLite state adapter type. Includes `migrateToLatest` for schema migrations, `vacuum` for reclaiming disk space, and `truncate` for clearing all job data.
 * @experimental
 */
export type SqliteStateAdapter<
  TTxContext extends BaseTxContext,
  TJobId extends string = UUID,
> = StateAdapter<TTxContext, TJobId> & {
  migrateToLatest: () => Promise<MigrationResult>;
  vacuum: () => Promise<void>;
  truncate: () => Promise<void>;
};
