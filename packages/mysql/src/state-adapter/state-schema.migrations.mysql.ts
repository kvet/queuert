import {
  type Migration,
  type MigrationResult,
  type TemplateApplier,
  type TypedSql,
  createMigrator,
  extractColumnTypes,
  extractParamTypes,
  sql,
  t,
} from "@queuert/typed-sql";
import type { BaseTxContext, RetryConfig } from "queuert";
import { withRetry } from "queuert/internal";

import { createMysqlMigrationStore } from "../migration-store/migration-store.mysql.ts";
import type { MysqlStateProvider } from "../state-provider/state-provider.mysql.ts";
import { snapshotStatements } from "./state-schema.mysql.ts";

type Row = Record<string, unknown>;

const SCHEMA_MIGRATION = "001_schema_v1";

const schemaStatements = [
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{prefix}}job (
  id                            {{job_id_type}} NOT NULL,
  chain_id                      {{job_id_type}} NOT NULL,
  chain_index                   INT NOT NULL,
  continued_to_id               {{job_id_type}} NULL,
  type_name                     {{name_type}} NOT NULL,
  status                        VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  chain_status                  VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at                    DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  scheduled_at                  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  completed_at                  DATETIME(6) NULL,
  last_attempt_at               DATETIME(6) NULL,
  attempt_at                    DATETIME(6) NULL,
  chain_completed_at            DATETIME(6) NULL,
  attempt                       INT NOT NULL DEFAULT 0,
  chain_deduplication_key       {{name_type}} NULL,
  chain_trace_context           TEXT NULL,
  trace_context                 TEXT NULL,
  last_attempt_error            JSON NULL,
  input                         JSON NULL,
  output                        JSON NULL,
  attempt_by                    {{worker_id_type}} NULL,
  completed_by                  {{worker_id_type}} NULL,
  attempt_token                 CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status_ts                     DATETIME(6) AS (CASE status WHEN 'running' THEN attempt_at WHEN 'completed' THEN completed_at ELSE scheduled_at END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY {{name_prefix}}chain_index_idx (chain_id, chain_index),
  KEY {{name_prefix}}job_status_idx (type_name, status, status_ts),
  KEY {{name_prefix}}job_idx (type_name, created_at),
  KEY {{name_prefix}}chain_idx (type_name, chain_index, created_at),
  KEY {{name_prefix}}chain_running_idx (type_name, chain_status, created_at),
  KEY {{name_prefix}}chain_completed_idx (type_name, chain_status, chain_completed_at),
  KEY {{name_prefix}}chain_deduplication_idx (chain_deduplication_key, type_name, chain_index, created_at),
  KEY {{name_prefix}}job_attempt_by_idx (attempt_by, status, attempt_at),
  CONSTRAINT {{name_prefix}}job_status_check CHECK (status IN ('blocked', 'pending', 'running', 'completed')),
  CONSTRAINT {{name_prefix}}job_chain_status_check CHECK (chain_status IN ('running', 'completed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE={{collation}}`,
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{prefix}}job_blocker (
  job_id                        {{job_id_type}} NOT NULL,
  blocked_by_chain_id           {{job_id_type}} NOT NULL,
  \`index\`                       INT NOT NULL,
  trace_context                 TEXT NULL,
  PRIMARY KEY (job_id, blocked_by_chain_id, \`index\`),
  KEY {{name_prefix}}job_blocker_chain_idx (blocked_by_chain_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE={{collation}}`,
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{prefix}}worker (
  id                            {{worker_id_type}} NOT NULL,
  type_names                    JSON NOT NULL,
  concurrency                   INT NOT NULL,
  started_at                    DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  lease_until                   DATETIME(6) NOT NULL,
  token                         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (id),
  KEY {{name_prefix}}worker_idx (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE={{collation}}`,
  /* sql */ `CREATE TABLE IF NOT EXISTS {{prefix}}schema_fence_v1 (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`,
];

const executeStatement = async <TTxContext extends BaseTxContext>(
  stateProvider: MysqlStateProvider<TTxContext>,
  txCtx: TTxContext | undefined,
  typedSql: TypedSql,
  params: unknown[] = [],
): Promise<Row[]> =>
  (await stateProvider.executeSql({
    txCtx,
    id: typedSql.id,
    sql: typedSql.sql,
    params,
    paramTypes: extractParamTypes(typedSql.params),
    columnTypes: extractColumnTypes(typedSql.columns),
    readOnly: typedSql.readOnly,
  })) as Row[];

export const createSchemaMigrations = <TTxContext extends BaseTxContext>(
  stateProvider: MysqlStateProvider<TTxContext>,
  applyTemplate: TemplateApplier,
  schema: string | undefined,
  transactionRetry: RetryConfig,
): Migration<TTxContext>[] => {
  const execute = async (
    txCtx: TTxContext | undefined,
    typedSql: TypedSql,
    params: unknown[] = [],
  ): Promise<Row[]> =>
    withRetry(
      async () => executeStatement(stateProvider, txCtx, typedSql, params),
      transactionRetry,
      (error) => stateProvider.classifyError({ error })?.kind === "transaction_conflict",
    );
  return [
    {
      name: SCHEMA_MIGRATION,
      type: "non-transactional",
      up: async () => {
        for (const statement of schemaStatements) {
          await execute(undefined, applyTemplate(sql(statement)));
        }
      },
      down: async () => {
        throw new Error("The Queuert schema cannot be reverted.");
      },
    },
    {
      name: "002_schema_v2",
      type: "non-transactional",
      up: async () => {
        const [fence] = await execute(
          undefined,
          applyTemplate(
            sql(
              `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ${schema === undefined ? "DATABASE()" : `'${schema}'`} AND table_name = '{{name_prefix}}schema_fence_v2'`,
              { columns: { count: t.number() } },
            ),
          ),
          [],
        );
        if (Number(fence.count) > 0) {
          await execute(
            undefined,
            applyTemplate(sql(/* sql */ `DROP TABLE IF EXISTS {{prefix}}schema_fence_v1`)),
            [],
          );
          return;
        }
        const hasJobColumn = async (name: string): Promise<boolean> => {
          const [column] = await execute(
            undefined,
            applyTemplate(
              sql(
                `SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = ${schema === undefined ? "DATABASE()" : `'${schema}'`} AND table_name = '{{name_prefix}}job' AND column_name = '${name}'`,
                { columns: { count: t.number() } },
              ),
            ),
            [],
          );
          return Number(column.count) > 0;
        };
        for (const [columnName, definition] of [
          ["blocking", "BOOLEAN NOT NULL DEFAULT FALSE"],
          ["blockers_remaining", "INT NOT NULL DEFAULT 0"],
        ]) {
          if (!(await hasJobColumn(columnName))) {
            await execute(
              undefined,
              applyTemplate(
                sql(`ALTER TABLE {{prefix}}job ADD COLUMN ${columnName} ${definition}`),
              ),
              [],
            );
          }
        }
        const [index] = await execute(
          undefined,
          applyTemplate(
            sql(
              `SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = ${schema === undefined ? "DATABASE()" : `'${schema}'`} AND table_name = '{{name_prefix}}job' AND index_name = '{{name_prefix}}chain_blocking_idx'`,
              { columns: { count: t.number() } },
            ),
          ),
          [],
        );
        if (Number(index.count) === 0) {
          await execute(
            undefined,
            applyTemplate(
              sql(
                /* sql */ `CREATE INDEX {{name_prefix}}chain_blocking_idx ON {{prefix}}job (type_name, blocking, chain_index, created_at)`,
              ),
            ),
            [],
          );
        }
        if (!(await hasJobColumn("last_reschedule_reason"))) {
          await execute(
            undefined,
            applyTemplate(
              sql(
                /* sql */ `ALTER TABLE {{prefix}}job ADD COLUMN consecutive_failures INT NOT NULL DEFAULT 0 AFTER attempt, ADD COLUMN last_attempt_error_text LONGTEXT NULL AFTER last_attempt_error, ADD COLUMN last_reschedule_reason TEXT NULL AFTER last_attempt_error_text`,
              ),
            ),
            [],
          );
        }
        for (const statement of [
          /* sql */ `DROP TABLE IF EXISTS {{prefix}}schema_fence_v1`,
          /* sql */ `
UPDATE {{prefix}}job h
SET h.blocking = TRUE
WHERE h.chain_index = 0
  AND h.blocking = FALSE
  AND h.id IN (SELECT jb.blocked_by_chain_id FROM {{prefix}}job_blocker jb)`,
          /* sql */ `
UPDATE {{prefix}}job j
LEFT JOIN (
  SELECT jb.job_id, COUNT(*) AS remaining
  FROM {{prefix}}job_blocker jb
  LEFT JOIN {{prefix}}job h ON h.id = jb.blocked_by_chain_id
  WHERE NOT (h.chain_status <=> 'completed')
  GROUP BY jb.job_id
) r ON r.job_id = j.id
SET j.blockers_remaining = COALESCE(r.remaining, 0)
WHERE j.status = 'blocked'`,
          /* sql */ `
UPDATE {{prefix}}job j
SET j.status = 'pending',
  j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6))
WHERE j.status = 'blocked' AND j.blockers_remaining = 0`,
          /* sql */ `
UPDATE {{prefix}}job j
SET j.status = 'pending',
  j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)),
  j.attempt_at = NULL,
  j.attempt_by = NULL,
  j.attempt_token = NULL
WHERE j.status = 'running'
  AND NOT EXISTS (SELECT 1 FROM {{prefix}}worker w WHERE w.id = j.attempt_by)`,
        ]) {
          await execute(undefined, applyTemplate(sql(statement)), []);
        }
        if (await hasJobColumn("last_attempt_error_text")) {
          const statements = (await hasJobColumn("last_attempt_error"))
            ? [
                /* sql */ `UPDATE {{prefix}}job SET last_attempt_error_text = JSON_UNQUOTE(last_attempt_error), consecutive_failures = 1 WHERE last_attempt_error IS NOT NULL`,
                /* sql */ `ALTER TABLE {{prefix}}job DROP COLUMN last_attempt_error`,
              ]
            : [];
          for (const statement of [
            ...statements,
            /* sql */ `ALTER TABLE {{prefix}}job RENAME COLUMN last_attempt_error_text TO last_attempt_error`,
          ]) {
            await execute(undefined, applyTemplate(sql(statement)), []);
          }
        }
        await execute(
          undefined,
          applyTemplate(
            sql(
              /* sql */ `CREATE TABLE IF NOT EXISTS {{prefix}}schema_fence_v2 (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`,
            ),
          ),
          [],
        );
      },
      down: async () => {
        throw new Error("The Queuert schema cannot be reverted.");
      },
    },
  ];
};

export const migrateSchemaToLatest = async <TTxContext extends BaseTxContext>(
  stateProvider: MysqlStateProvider<TTxContext>,
  applyTemplate: TemplateApplier,
  schema: string | undefined,
  transactionRetry: RetryConfig,
): Promise<MigrationResult> => {
  const qualifiedPrefix = applyTemplate(sql("{{prefix}}")).sql;
  const store = createMysqlMigrationStore({
    stateProvider,
    migrationTable: `${qualifiedPrefix}migration`,
    lockTable: `${qualifiedPrefix}migration_lock`,
  });
  const migrations = createSchemaMigrations(stateProvider, applyTemplate, schema, transactionRetry);
  const hasSchemaV1JobTable = async (txCtx: TTxContext): Promise<boolean> => {
    const [table] = await executeStatement(
      stateProvider,
      txCtx,
      applyTemplate(
        sql(
          `SELECT COUNT(*) AS count FROM information_schema.tables t WHERE t.table_schema = ${schema === undefined ? "DATABASE()" : `'${schema}'`} AND t.table_name = '{{name_prefix}}job' AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = 'blocking')`,
          { columns: { count: t.number() } },
        ),
      ),
    );
    return Number(table.count) > 0;
  };
  const installed: string[] = [];
  const result = await createMigrator({
    migrations,
    store,
    before: async () => {
      installed.push(
        ...(await store.runInTransaction(async (txCtx) => {
          if ((await store.getAppliedMigrationNames(txCtx)).length > 0) return [];
          if (await hasSchemaV1JobTable(txCtx)) return [];
          for (const statement of snapshotStatements) {
            await executeStatement(stateProvider, txCtx, applyTemplate(sql(statement)));
          }
          for (const { name } of migrations) await store.recordMigration(txCtx, name);
          return migrations.map(({ name }) => name);
        })),
      );
    },
  }).migrateToLatest();
  return {
    ...result,
    applied: [...installed, ...result.applied],
    skipped: result.skipped.filter((name) => !installed.includes(name)),
  };
};
