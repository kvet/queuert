import { type UUID, randomUUID } from "node:crypto";

import {
  type DataType,
  type InferColumns,
  type InferParams,
  type MigrationResult,
  type TypedSql,
  createTemplateApplier,
  executeMigrations,
  extractColumnTypes,
  extractParamTypes,
  t,
} from "@queuert/typed-sql";
import { type BaseTxContext, type StateAdapter } from "queuert";
import {
  type StateJob,
  createIdValidator,
  decodeCreatedAtWithIdCursor,
  decodeIdCursor,
  encodeCursor,
} from "queuert/internal";

import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";
import {
  type DbJob,
  type DbChainRow,
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

/**
 * Builds a SQL boolean expression (or `null`) selecting rows that match any of
 * the given structural predicates. Within a predicate the conditions are ANDed;
 * predicates are ORed. All comparisons are against columns or `now()`, so no
 * bound parameters are produced.
 */
const buildStatePredicatesSql = (
  predicates:
    | {
        completed?: boolean;
        succeeded?: boolean;
        leased?: boolean;
        hasOpenBlockers?: boolean;
        scheduledInFuture?: boolean;
      }[]
    | undefined,
  alias: string,
): string | null => {
  if (!predicates || predicates.length === 0) return null;
  const ored = predicates.map((p) => {
    const parts: string[] = [];
    if (p.completed !== undefined) {
      parts.push(`${alias}.completed_at IS ${p.completed ? "NOT NULL" : "NULL"}`);
    }
    if (p.succeeded !== undefined) {
      parts.push(`${alias}.continued_to_job_id IS ${p.succeeded ? "NOT NULL" : "NULL"}`);
    }
    if (p.leased !== undefined) {
      parts.push(`${alias}.leased_until IS ${p.leased ? "NOT NULL" : "NULL"}`);
    }
    if (p.hasOpenBlockers !== undefined) {
      parts.push(`${alias}.has_open_blockers = ${p.hasOpenBlockers ? 1 : 0}`);
    }
    if (p.scheduledInFuture !== undefined) {
      parts.push(
        `${alias}.scheduled_at ${p.scheduledInFuture ? ">" : "<="} datetime('now', 'subsec')`,
      );
    }
    return parts.length > 0 ? `(${parts.join(" AND ")})` : "1=1";
  });
  return `(${ored.join(" OR ")})`;
};

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
    continuedToJobId: dbJob.continued_to_job_id,
    hasOpenBlockers: dbJob.has_open_blockers === 1,
    scheduledInFuture: dbJob.scheduled_in_future === 1,
    input: parseJson(dbJob.input),
    output: parseJson(dbJob.output),

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

const parseDbChainRow = (row: DbChainRow): { rootJob: DbJob; lastChainJob: DbJob | null } => {
  const rootJob: DbJob = {
    id: row.id,
    type_name: row.type_name,
    chain_id: row.chain_id,
    chain_type_name: row.chain_type_name,
    chain_index: row.chain_index,
    continued_to_job_id: row.continued_to_job_id,
    input: row.input,
    output: row.output,
    has_open_blockers: row.has_open_blockers,
    scheduled_in_future: row.scheduled_in_future,
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
        continued_to_job_id: row.lc_continued_to_job_id,
        input: row.lc_input,
        output: row.lc_output,
        has_open_blockers: row.lc_has_open_blockers!,
        scheduled_in_future: row.lc_scheduled_in_future!,
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
  generateId: generateIdOption = () => crypto.randomUUID() as TIdType,
  validateId: validateIdOption,
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
  generateId?: () => TIdType;
  /** Predicate returning `true` if the ID is acceptable. Runs on both generated and caller-supplied IDs; failures throw `InvalidJobIdError`. */
  validateId?: (id: TIdType) => boolean;
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

  const { validateId, generateId } = createIdValidator<TIdType>({
    generateIdOption,
    validateIdOption,
  });

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
      id: resolvedSql.id,
      sql: resolvedSql.sql,
      params: params ?? [],
      paramTypes: extractParamTypes(resolvedSql.params),
      columnTypes: extractColumnTypes(resolvedSql.columns),
      readOnly: resolvedSql.readOnly,
    }) as Promise<InferColumns<TColumns>[]>;
  };

  const expandChainIds = async (
    txCtx: TTxContext | undefined,
    chainIds: readonly TIdType[],
  ): Promise<TIdType[]> => {
    if (chainIds.length === 0) return [];
    const connected = await executeTypedSql({
      txCtx,
      sql: defs.getConnectedChainIdsSql,
      params: [JSON.stringify(chainIds)],
    });
    return connected.map((r) => r.chain_id) as TIdType[];
  };

  const getExternalBlockerRefs = async (
    txCtx: TTxContext | undefined,
    effectiveChainIds: readonly TIdType[],
  ): Promise<{ chainId: string; referencedByJobId: string }[]> => {
    if (effectiveChainIds.length === 0) return [];
    const idsJson = JSON.stringify(effectiveChainIds);
    const refs = await executeTypedSql({
      txCtx,
      sql: defs.checkExternalBlockerRefsSql,
      params: [idsJson, idsJson],
    });
    return refs.map((r) => ({
      chainId: r.blocked_by_chain_id,
      referencedByJobId: r.job_id,
    }));
  };

  const rawAdapter: StateAdapter<TTxContext, TIdType> = {
    withTransaction: stateProvider.withTransaction,

    withSavepoint:
      stateProvider.withSavepoint ??
      (async (txCtx, fn) => {
        const sp = `queuert_sp_${randomUUID().replace(/-/g, "_")}`;
        await stateProvider.executeSql({
          txCtx,
          sql: `SAVEPOINT ${sp}`,
          params: [],
          paramTypes: {},
          columnTypes: {},
          readOnly: false,
        });
        try {
          const result = await fn(txCtx);
          await stateProvider.executeSql({
            txCtx,
            sql: `RELEASE SAVEPOINT ${sp}`,
            params: [],
            paramTypes: {},
            columnTypes: {},
            readOnly: false,
          });
          return result;
        } catch (error) {
          await stateProvider
            .executeSql({
              txCtx,
              sql: `ROLLBACK TO SAVEPOINT ${sp}`,
              params: [],
              paramTypes: {},
              columnTypes: {},
              readOnly: false,
            })
            .catch(() => {});
          throw error;
        }
      }),

    getChain: async ({ txCtx, chainId, lock }) => {
      if (lock === "exclusive" && txCtx) {
        await executeTypedSql({
          txCtx,
          sql: defs.lockLatestChainJobSql,
          params: [chainId],
        });
      }
      const [row] = await executeTypedSql({
        txCtx,
        sql: defs.getChainSql,
        params: [chainId, chainId],
      });

      if (!row) return undefined;

      const { rootJob, lastChainJob } = parseDbChainRow(row);

      return [
        mapDbJobToStateJob(rootJob),
        lastChainJob && lastChainJob.id !== rootJob.id
          ? mapDbJobToStateJob(lastChainJob)
          : undefined,
      ];
    },
    getJob: async ({ txCtx, jobId, lock }) => {
      const [job] = await executeTypedSql({
        txCtx,
        sql: lock === "exclusive" && txCtx ? defs.getJobLockedSql : defs.getJobSql,
        params: [jobId],
      });

      return job ? mapDbJobToStateJob(job) : undefined;
    },

    createJobs: async ({ txCtx, jobs }) => {
      for (const job of jobs) {
        if (job.id !== undefined) validateId(job.id, "caller");
      }
      const results: { job: StateJob; deduplicated: boolean }[] = Array.from({
        length: jobs.length,
      });
      const toInsert: {
        index: number;
        id: string;
        continueFromJobId: string | null;
        json: Record<string, unknown>;
      }[] = [];
      const intraBatchDedup = new Map<string, number>();
      const deferredDupes: { index: number; firstIndex: number }[] = [];

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const { typeName, id: providedId, input, schedule, chainTraceContext, traceContext } = job;
        const isChainStart = "chainTypeName" in job;
        const continueFromJobId = !isChainStart ? job.continueFromJobId : null;

        if (isChainStart && job.deduplication?.key) {
          const deduplicationKey = job.deduplication.key;
          const deduplicationScope = job.deduplication.scope ?? "open";
          const deduplicationWindowMs = job.deduplication.windowMs ?? null;
          const deduplicationExcludeChainIds = job.deduplication.excludeChainIds
            ? JSON.stringify(job.deduplication.excludeChainIds)
            : null;

          const batchKey = `${deduplicationKey}\0${job.chainTypeName}`;
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
              job.chainTypeName,
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

        const newId = providedId ?? generateId();
        toInsert.push({
          index: i,
          id: newId,
          continueFromJobId,
          json: {
            id: newId,
            continue_from_job_id: continueFromJobId,
            type_name: typeName,
            chain_type_name: isChainStart ? job.chainTypeName : null,
            input: input !== undefined ? JSON.stringify(input) : null,
            deduplication_key: isChainStart ? (job.deduplication?.key ?? null) : null,
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

        const parentUpdates = toInsert
          .map((item, j) => ({ item, row: insertedRows[j] }))
          .filter(({ item }) => item.continueFromJobId !== null)
          .map(({ item, row }) => ({
            parent_id: item.continueFromJobId,
            new_id: row.id,
          }));

        if (parentUpdates.length > 0) {
          await executeTypedSql({
            txCtx,
            sql: defs.updateParentContinuedToJobIdSql,
            params: [JSON.stringify(parentUpdates)],
          });
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
          .filter((b) => b.blocker_completed !== 1)
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
          sql: defs.getJobForBlockersSql,
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
        const { rootJob, lastChainJob } = parseDbChainRow(row);
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
    acquireJob: async ({ txCtx, typeNames, workerId, leaseDurationMs }) => {
      const typeNamesJson = JSON.stringify(typeNames);
      const [result] = await executeTypedSql({
        txCtx,
        sql: defs.acquireJobSql,
        params: [workerId, leaseDurationMs, typeNamesJson, typeNamesJson],
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
    deleteChains: async ({ txCtx, chainIds, cascade }) => {
      const effectiveChainIds = cascade ? await expandChainIds(txCtx, chainIds) : chainIds;
      if (effectiveChainIds.length === 0) return { deleted: [], blockerRefs: [] };

      const blockerRefs = await getExternalBlockerRefs(txCtx, effectiveChainIds);
      if (blockerRefs.length > 0) return { deleted: [], blockerRefs };

      const chainIdsJson = JSON.stringify(effectiveChainIds);
      const rows = await executeTypedSql({
        txCtx,
        sql: defs.getChainsByChainIdsSql,
        params: [chainIdsJson],
      });
      await executeTypedSql({
        txCtx,
        sql: defs.deleteBlockersByChainIdsSql,
        params: [chainIdsJson],
      });
      await executeTypedSql({
        txCtx,
        sql: defs.deleteChainsSql,
        params: [chainIdsJson],
      });
      const deleted = rows.map((row) => {
        const { rootJob, lastChainJob } = parseDbChainRow(row);
        return [
          mapDbJobToStateJob(rootJob),
          lastChainJob && lastChainJob.id !== rootJob.id
            ? mapDbJobToStateJob(lastChainJob)
            : undefined,
        ] as [StateJob, StateJob | undefined];
      });
      return { deleted, blockerRefs: [] };
    },
    listChains: async ({ txCtx, filter, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtWithIdCursor(page.cursor) : null;
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
      if (filter?.closed !== undefined) {
        conditions.push(`lc.completed_at IS ${filter.closed ? "NOT NULL" : "NULL"}`);
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
        paramTypes: {},
        columnTypes: extractColumnTypes(defs.dbChainRowColumns),
        readOnly: true,
      })) as DbChainRow[];

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;

      const items: [StateJob, StateJob | undefined][] = pageRows.map((row) => {
        const { rootJob, lastChainJob } = parseDbChainRow(row);
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
        const { rootJob } = parseDbChainRow(lastRow);
        nextCursor = encodeCursor({
          type: "createdAtWithId",
          id: rootJob.id,
          createdAt: new Date(rootJob.created_at + "Z").toISOString(),
        });
      }

      return { items, nextCursor };
    },

    listJobs: async ({ txCtx, filter, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtWithIdCursor(page.cursor) : null;
      const conditions: string[] = [];
      const params: unknown[] = [];

      const statePredicatesSql = buildStatePredicatesSql(filter?.statePredicates, "j");
      if (statePredicatesSql) {
        conditions.push(statePredicatesSql);
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
        paramTypes: {},
        columnTypes: extractColumnTypes(defs.dbJobColumns),
        readOnly: true,
      })) as DbJob[];

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const items = pageRows.map(mapDbJobToStateJob);

      const lastRow = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        nextCursor = encodeCursor({
          type: "createdAtWithId",
          id: lastRow.id,
          createdAt: new Date(lastRow.created_at + "Z").toISOString(),
        });
      }

      return { items, nextCursor };
    },

    listChainJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeIdCursor(page.cursor) : null;
      const orderDir = orderDirection === "asc" ? "ASC" : "DESC";
      const params: unknown[] = [chainId];
      let sqlStr: string;

      if (cursor) {
        const cmp = orderDirection === "asc" ? ">" : "<";
        params.length = 0;
        params.push(chainId, cursor.id, chainId, page.limit + 1);
        sqlStr = `WITH start_row AS (
          SELECT c.chain_index AS sc
          FROM ${tablePrefix}job c
          WHERE c.chain_id = ? AND c.id = ?
        )
        SELECT j.* FROM ${tablePrefix}job j, start_row s
        WHERE j.chain_id = ?
          AND j.chain_index ${cmp} s.sc
        ORDER BY j.chain_index ${orderDir}, j.id ${orderDir}
        LIMIT ?`;
      } else {
        params.push(page.limit + 1);
        sqlStr = `SELECT * FROM ${tablePrefix}job j
        WHERE j.chain_id = ?
        ORDER BY j.chain_index ${orderDir}, j.id ${orderDir}
        LIMIT ?`;
      }

      const rows = (await stateProvider.executeSql({
        txCtx,
        sql: sqlStr,
        params,
        paramTypes: {},
        columnTypes: extractColumnTypes(defs.dbJobColumns),
        readOnly: true,
      })) as DbJob[];

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const items = pageRows.map(mapDbJobToStateJob);

      const lastRow = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        nextCursor = encodeCursor({ type: "id", id: lastRow.id });
      }

      return { items, nextCursor };
    },

    triggerJobs: async ({ txCtx, jobIds }) => {
      if (jobIds.length === 0) return { triggered: [], notFound: [], notTriggerable: [] };
      const idsJson = JSON.stringify(jobIds);

      const rows = await executeTypedSql({
        txCtx,
        sql: defs.triggerJobsSql,
        params: [idsJson],
      });

      if (rows.length > 0) {
        const orderById = new Map(jobIds.map((id, i) => [id as string, i]));
        rows.sort((a, b) => orderById.get(a.id)! - orderById.get(b.id)!);
        return {
          triggered: rows.map((row) => mapDbJobToStateJob(row)),
          notFound: [],
          notTriggerable: [],
        };
      }

      const jobRows = await executeTypedSql({
        txCtx,
        sql: defs.getJobsByIdsSql,
        params: [idsJson],
      });
      const jobById = new Map(jobRows.map((r) => [r.id, r]));

      const notFound: TIdType[] = [];
      const notTriggerable: StateJob[] = [];
      const seen = new Set<string>();
      for (const id of jobIds) {
        const key = id as string;
        if (seen.has(key)) continue;
        seen.add(key);
        const job = jobById.get(key);
        if (job === undefined) {
          notFound.push(id);
        } else if (
          job.completed_at !== null ||
          job.leased_until !== null ||
          job.has_open_blockers === 1
        ) {
          notTriggerable.push(mapDbJobToStateJob(job));
        }
      }

      return { triggered: [], notFound, notTriggerable };
    },

    close: async () => {
      await stateProvider.close?.();
    },

    listBlockedJobs: async ({ txCtx, chainId, orderDirection, page }) => {
      const cursor = page.cursor ? decodeCreatedAtWithIdCursor(page.cursor) : null;
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
        paramTypes: {},
        columnTypes: extractColumnTypes(defs.dbJobColumns),
        readOnly: true,
      })) as DbJob[];

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const items = pageRows.map(mapDbJobToStateJob);

      const lastRow = pageRows[pageRows.length - 1];
      let nextCursor: string | null = null;
      if (hasMore && lastRow) {
        nextCursor = encodeCursor({
          type: "createdAtWithId",
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
            params: [],
            paramTypes: {},
            columnTypes: { foreign_keys: "number" },
            readOnly: true,
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
          params: [],
          paramTypes: {},
          columnTypes: { auto_vacuum: "number" },
          readOnly: true,
        })) as { auto_vacuum: number }[];
        if (!avResult || avResult.auto_vacuum !== 2) {
          throw new Error(
            "SQLite auto_vacuum pragma is not set to INCREMENTAL. " +
              "Enable it with PRAGMA auto_vacuum = INCREMENTAL before creating tables. " +
              "Incremental auto-vacuum is required for vacuum() to reclaim disk space.",
          );
        }
      }

      return executeMigrations<TTxContext>({
        migrations,
        runInTransaction: stateProvider.withTransaction,
        getAppliedMigrationNames: async (txCtx) => {
          await stateProvider.executeSql({
            txCtx,
            sql: applyTemplate(defs.createMigrationTableSql).sql,
            params: [],
            paramTypes: {},
            columnTypes: {},
            readOnly: false,
          });
          const applied = (await stateProvider.executeSql({
            txCtx,
            sql: applyTemplate(defs.getAppliedMigrationsSql).sql,
            params: [],
            paramTypes: {},
            columnTypes: { name: "string", applied_at: "string" },
            readOnly: true,
          })) as { name: string }[];
          return applied.map((m) => m.name);
        },
        executeMigrationStatements: async (txCtx, migration) => {
          for (const stmt of migration.statements) {
            await stateProvider.executeSql({
              txCtx,
              sql: applyTemplate(stmt.sql).sql,
              params: [],
              paramTypes: {},
              columnTypes: {},
              readOnly: false,
            });
          }
        },
        recordMigration: async (txCtx, name) => {
          await stateProvider.executeSql({
            txCtx,
            sql: applyTemplate(defs.recordMigrationSql).sql,
            params: [name],
            paramTypes: { 0: "string" },
            columnTypes: {},
            readOnly: false,
          });
        },
      });
    },
    vacuum: async () => {
      await stateProvider.executeSql({
        sql: "PRAGMA incremental_vacuum",
        params: [],
        paramTypes: {},
        columnTypes: {},
        readOnly: false,
      });
    },
    truncate: async () => {
      await stateProvider.executeSql({
        sql: `DELETE FROM ${tablePrefix}job_blocker`,
        params: [],
        paramTypes: {},
        columnTypes: {},
        readOnly: false,
      });
      await stateProvider.executeSql({
        sql: `DELETE FROM ${tablePrefix}job`,
        params: [],
        paramTypes: {},
        columnTypes: {},
        readOnly: false,
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
