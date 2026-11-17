import type { BaseTxContext } from "queuert";
import { type StateDump, chunkItems, createSqlDumpRowMapper } from "queuert/conformance-internal";

import type { MysqlStateProvider } from "../state-provider/state-provider.mysql.ts";

const BATCH_SIZE = 5_000;

const ID = "CHAR(36) CHARACTER SET ascii";
const TEXT = "LONGTEXT CHARACTER SET utf8mb4";
const TIMESTAMP = "DATETIME(6)";

const jobColumns = {
  id: ID,
  type_name: "VARCHAR(255) CHARACTER SET utf8mb4",
  chain_id: ID,
  chain_index: "INT",
  continued_to_id: ID,
  status: "VARCHAR(16) CHARACTER SET ascii",
  chain_status: "VARCHAR(16) CHARACTER SET ascii",
  chain_deduplication_key: TEXT,
  chain_trace_context: TEXT,
  trace_context: TEXT,
  input: TEXT,
  output: TEXT,
  attempt: "INT",
  last_attempt_error: TEXT,
  attempt_by: ID,
  attempt_token: ID,
  completed_by: ID,
  created_at: TIMESTAMP,
  scheduled_at: TIMESTAMP,
  completed_at: TIMESTAMP,
  last_attempt_at: TIMESTAMP,
  attempt_at: TIMESTAMP,
  chain_completed_at: TIMESTAMP,
  has_dependents: "TINYINT",
  blockers_remaining: "INT",
};

const blockerColumns = {
  job_id: ID,
  blocked_by_chain_id: ID,
  index: "INT",
  trace_context: TEXT,
};

const workerColumns = {
  id: ID,
  type_names: TEXT,
  concurrency: "INT",
  token: ID,
  started_at: TIMESTAMP,
  lease_until: TIMESTAMP,
};

const jsonColumns = new Set(["input", "output", "last_attempt_error", "type_names"]);

export const loadStateDump = async <TTxContext extends BaseTxContext>(
  stateProvider: MysqlStateProvider<TTxContext>,
  dump: StateDump,
  { offsetMs, tablePrefix = "queuert_" }: { offsetMs: number; tablePrefix?: string },
): Promise<void> => {
  const mapRow = createSqlDumpRowMapper(dump, offsetMs, {
    timestamp: (ms) => new Date(ms).toISOString().slice(0, 23).replace("T", " "),
    json: (value) => JSON.stringify(value),
  });

  const insertRows = async <T>(
    table: string,
    columns: Record<string, string>,
    items: readonly T[],
    toRow: (item: T) => Record<string, unknown>,
  ): Promise<void> => {
    const names = Object.keys(columns);
    const sql = `INSERT INTO ${tablePrefix}${table} (${names.map((name) => `\`${name}\``).join(", ")})
      SELECT ${names.map((name) => (jsonColumns.has(name) ? `JSON_EXTRACT(d.\`${name}\`, '$')` : `d.\`${name}\``)).join(", ")}
      FROM JSON_TABLE(?, '$[*]' COLUMNS (
        ${names.map((name) => `\`${name}\` ${columns[name]} PATH '$.${name}'`).join(",\n        ")}
      )) d`;
    for (const batch of chunkItems(items, BATCH_SIZE)) {
      await stateProvider.executeSql({
        sql,
        params: [JSON.stringify(batch.map(toRow))],
        paramTypes: {},
        columnTypes: {},
        readOnly: false,
      });
    }
  };

  const referencedChainIds = new Set(dump.blockers.map((blocker) => blocker.blockedByChainId));
  const completedChainIds = new Set(
    dump.chains.filter((chain) => chain.status === "completed").map((chain) => chain.id),
  );
  const blockersRemaining = new Map<string, number>();
  for (const blocker of dump.blockers) {
    if (completedChainIds.has(blocker.blockedByChainId)) continue;
    blockersRemaining.set(blocker.jobId, (blockersRemaining.get(blocker.jobId) ?? 0) + 1);
  }
  await insertRows("job", jobColumns, dump.jobs, (job) => ({
    ...mapRow.job(job),
    has_dependents: job.chainIndex === 0 && referencedChainIds.has(job.id) ? 1 : 0,
    blockers_remaining: job.status === "blocked" ? (blockersRemaining.get(job.id) ?? 0) : 0,
  }));
  await insertRows("job_blocker", blockerColumns, dump.blockers, mapRow.blocker);
  await insertRows("worker", workerColumns, dump.workers, mapRow.worker);
};
