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

  const referencedChainIds = new Set(dump.blockers.map((blocker) => blocker.blockedByChainId));
  const completedChainIds = new Set(
    dump.chains.filter((chain) => chain.status === "completed").map((chain) => chain.id),
  );
  const blockersRemaining = new Map<string, number>();
  for (const blocker of dump.blockers) {
    if (completedChainIds.has(blocker.blockedByChainId)) continue;
    blockersRemaining.set(blocker.jobId, (blockersRemaining.get(blocker.jobId) ?? 0) + 1);
  }
  await insertRows("job", dump.jobs, (job) => ({
    ...mapRow.job(job),
    has_dependents: job.chainIndex === 0 && referencedChainIds.has(job.id),
    blockers_remaining: job.status === "blocked" ? (blockersRemaining.get(job.id) ?? 0) : 0,
  }));
  await insertRows("job_blocker", dump.blockers, mapRow.blocker);
  await insertRows("worker", dump.workers, mapRow.worker);
};
