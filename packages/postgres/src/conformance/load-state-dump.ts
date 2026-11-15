import type { BaseTxContext } from "queuert";
import { type StateDump, chunkItems, createSqlDumpRowMapper } from "queuert/conformance-internal";

import type { PgStateProvider } from "../state-provider/state-provider.pg.ts";

const BATCH_SIZE = 5_000;

export const loadStateDump = async <TTxContext extends BaseTxContext>(
  stateProvider: PgStateProvider<TTxContext>,
  dump: StateDump,
  {
    offsetMs,
    schema = "public",
    tablePrefix = "queuert_",
  }: { offsetMs: number; schema?: string; tablePrefix?: string },
): Promise<void> => {
  const mapRow = createSqlDumpRowMapper(dump, offsetMs, {
    timestamp: (ms) => new Date(ms).toISOString(),
    json: (value) => value,
  });

  const insertRows = async <T>(
    table: string,
    items: readonly T[],
    toRow: (item: T) => Record<string, unknown>,
  ): Promise<void> => {
    const qualifiedTable = `${schema}.${tablePrefix}${table}`;
    for (const batch of chunkItems(items, BATCH_SIZE)) {
      await stateProvider.executeSql({
        sql: `INSERT INTO ${qualifiedTable} SELECT * FROM jsonb_populate_recordset(NULL::${qualifiedTable}, $1::jsonb)`,
        params: [JSON.stringify(batch.map(toRow))],
        paramTypes: {},
        columnTypes: {},
        readOnly: false,
      });
    }
  };

  await insertRows("job", dump.jobs, mapRow.job);
  await insertRows("job_blocker", dump.blockers, mapRow.blocker);
  await insertRows("worker", dump.workers, mapRow.worker);
};
