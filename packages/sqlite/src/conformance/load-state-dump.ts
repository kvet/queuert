import type { Mode } from "@queuert/sync-async";
import type { BaseTxContext } from "queuert";
import { type StateDump, chunkItems, createSqlDumpRowMapper } from "queuert/conformance-internal";

import type { SqliteStateProvider } from "../state-provider/state-provider.sqlite.ts";

const BATCH_SIZE = 5_000;

export const loadStateDump = async <TTxContext extends BaseTxContext>(
  stateProvider: SqliteStateProvider<TTxContext, Mode>,
  dump: StateDump,
  { offsetMs, tablePrefix = "queuert_" }: { offsetMs: number; tablePrefix?: string },
): Promise<void> => {
  const mapRow = createSqlDumpRowMapper(dump, offsetMs, {
    timestamp: (ms) => new Date(ms).toISOString().replace("T", " ").replace("Z", ""),
    json: (value) => JSON.stringify(value),
  });

  const insertRows = async <T>(
    table: string,
    items: readonly T[],
    toRow: (item: T) => Record<string, unknown>,
  ): Promise<void> => {
    for (const batch of chunkItems(items, BATCH_SIZE)) {
      const rows = batch.map(toRow);
      const columns = Object.keys(rows[0]);
      await stateProvider.executeSql({
        sql: `INSERT INTO ${tablePrefix}${table} (${columns.map((column) => `"${column}"`).join(", ")})
              SELECT ${columns.map((column) => `json_extract(value, '$.${column}')`).join(", ")}
              FROM json_each(?)`,
        params: [JSON.stringify(rows)],
        paramTypes: {},
        columnTypes: {},
        readOnly: false,
      });
    }
  };

  const referencedChainIds = new Set(dump.blockers.map((blocker) => blocker.blockedByChainId));
  await insertRows("job", dump.jobs, (job) => ({
    ...mapRow.job(job),
    has_dependents: job.chainIndex === 0 && referencedChainIds.has(job.id) ? 1 : 0,
  }));
  await insertRows("job_blocker", dump.blockers, mapRow.blocker);
  await insertRows("worker", dump.workers, mapRow.worker);
};
