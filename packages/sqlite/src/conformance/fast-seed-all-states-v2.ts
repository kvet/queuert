import { randomUUID } from "node:crypto";

import { type BaseTxContext } from "queuert";
import { type SeedSentinelsV2, seedConfigV2 } from "queuert/testing";

import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";

const CHUNK = 200;

const generateIds = (count: number): string[] => Array.from({ length: count }, () => randomUUID());

const futureTs = (ms: number) => `datetime('now', 'subsec', '+${ms / 1000} seconds')`;
const pastTs = (seconds: number) => `datetime('now', 'subsec', '-${seconds} seconds')`;

export const fastSeedAllStatesV2 = async <TTxContext extends BaseTxContext>(
  stateProvider: SqliteStateProvider<TTxContext>,
  { scale = 1, tablePrefix = "queuert_" }: { scale?: number; tablePrefix?: string } = {},
): Promise<SeedSentinelsV2> => {
  const job = `${tablePrefix}job`;
  const blockerTable = `${tablePrefix}job_blocker`;

  const exec = async (sql: string, params: unknown[] = []) =>
    stateProvider.executeSql({
      sql,
      params,
      paramTypes: {},
      columnTypes: {},
      readOnly: false,
    });

  const bulkInsertJobs = async (
    ids: string[],
    columns: string,
    valueFn: (id: string, i: number) => string,
    params: unknown[] = [],
  ) => {
    for (let start = 0; start < ids.length; start += CHUNK) {
      const chunk = ids.slice(start, start + CHUNK);
      const rows = chunk.map((id, ci) => valueFn(id, start + ci));
      await exec(`INSERT INTO ${job} (${columns}) VALUES ${rows.join(",\n")}`, params);
    }
  };

  // --- Block: Pending jobs ---
  const pendingIds: Record<string, string[]> = {};
  for (const typeName of seedConfigV2.pendingTypes) {
    const count = seedConfigV2.pendingPerType * scale;
    const ids = generateIds(count);
    pendingIds[typeName] = ids;
    await bulkInsertJobs(
      ids,
      "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, created_at",
      (id, i) =>
        `('${id}', '${typeName}', '${id}', '${typeName}', 0, '${JSON.stringify({ index: i })}', 0, ${pastTs(600)})`,
    );
  }

  // --- Block: Scheduled ---
  const scheduledIds = generateIds(seedConfigV2.scheduledCount * scale);
  await bulkInsertJobs(
    scheduledIds,
    "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, scheduled_at, created_at",
    (id, i) =>
      `('${id}', 'seed:scheduled', '${id}', 'seed:scheduled', 0, '${JSON.stringify({ index: i })}', 0, ${futureTs(seedConfigV2.futureMs)}, ${pastTs(600)})`,
  );

  // --- Block: Running ---
  const runningIds: Record<string, string[]> = {};
  for (const typeName of seedConfigV2.runningTypes) {
    const count = seedConfigV2.runningPerType * scale;
    const ids = generateIds(count);
    runningIds[typeName] = ids;
    await bulkInsertJobs(
      ids,
      "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, attempt, attempt_at, attempt_by, attempt_until, created_at",
      (id, i) =>
        `('${id}', '${typeName}', '${id}', '${typeName}', 0, '${JSON.stringify({ index: i })}', 0, 1, datetime('now', 'subsec'), '${seedConfigV2.workerId}', ${futureTs(seedConfigV2.attemptMs)}, ${pastTs(540)})`,
    );
  }

  // --- Block: Completed ---
  const completedIds: Record<string, string[]> = {};
  for (const typeName of seedConfigV2.completedTypes) {
    const count = seedConfigV2.completedPerType * scale;
    const ids = generateIds(count);
    completedIds[typeName] = ids;
    await bulkInsertJobs(
      ids,
      "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, attempt, completed_at, completed_by, output, created_at",
      (id, i) =>
        `('${id}', '${typeName}', '${id}', '${typeName}', 0, '${JSON.stringify({ index: i })}', 0, 1, ${pastTs(300)}, '${seedConfigV2.workerId}', '${JSON.stringify({ ok: true, index: i })}', ${pastTs(480)})`,
    );
  }

  // --- Block: Retried ---
  const retriedIds = generateIds(seedConfigV2.retriedCount * scale);
  await bulkInsertJobs(
    retriedIds,
    "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, attempt, last_attempt_at, last_attempt_error, scheduled_at, created_at",
    (id, i) =>
      `('${id}', 'seed:retried', '${id}', 'seed:retried', 0, '${JSON.stringify({ index: i })}', 0, 1, datetime('now', 'subsec'), '"seeded transient failure"', ${futureTs(seedConfigV2.futureMs)}, ${pastTs(420)})`,
  );

  // --- Block: Fan-in (tiered) ---
  const fanInBlockerChainIds: string[] = [];
  let fanInBlockedJobId: string | undefined;
  let fanInBlockedCount = 0;

  for (const tier of seedConfigV2.fanInTiers) {
    const blockedCount = tier.blocked * scale;
    const blockerCount = tier.blockers;
    const tierName = `seed:blocked:fanin:${blockerCount}`;
    const tierBlockerName = `seed:blocker:gate:${blockerCount}`;

    const blockerIds = generateIds(blockerCount);
    fanInBlockerChainIds.push(...blockerIds);
    await bulkInsertJobs(
      blockerIds,
      "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, scheduled_at, created_at",
      (id, i) =>
        `('${id}', '${tierBlockerName}', '${id}', '${tierBlockerName}', 0, '${JSON.stringify({ index: i })}', 0, ${futureTs(seedConfigV2.futureMs)}, ${pastTs(360)})`,
    );

    const blockedIds = generateIds(blockedCount);
    fanInBlockedJobId ??= blockedIds[0];
    await bulkInsertJobs(
      blockedIds,
      "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, created_at",
      (id, i) =>
        `('${id}', '${tierName}', '${id}', '${tierName}', 0, '${JSON.stringify({ index: i })}', 1, ${pastTs(120)})`,
    );

    // Link each blocked job to all blockers in this tier
    for (let start = 0; start < blockedIds.length; start += CHUNK) {
      const chunk = blockedIds.slice(start, start + CHUNK);
      const rows = chunk.flatMap((jobId) =>
        blockerIds.map((blockerId, idx) => `('${jobId}', '${blockerId}', ${idx})`),
      );
      await exec(
        `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, "index") VALUES ${rows.join(", ")}`,
      );
    }

    fanInBlockedCount += blockedCount;
  }

  // --- Block: Fan-out (tiered) ---
  let fanOutBlockerChainId: string | undefined;
  const fanOutBlockedJobIds: string[] = [];
  let fanOutBlockedCount = 0;

  for (const tier of seedConfigV2.fanOutTiers) {
    const blockerCount = tier.blockers * scale;
    const blockedPerBlocker = tier.blockedPer;
    const totalBlocked = blockerCount * blockedPerBlocker;
    const tierBlockerName = `seed:blocker:fanout:${tier.blockers}`;
    const tierBlockedName = `seed:blocked:fanout:${tier.blockers}`;

    const blockerIds = generateIds(blockerCount);
    fanOutBlockerChainId ??= blockerIds[0];
    await bulkInsertJobs(
      blockerIds,
      "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, scheduled_at, created_at",
      (id, i) =>
        `('${id}', '${tierBlockerName}', '${id}', '${tierBlockerName}', 0, '${JSON.stringify({ index: i })}', 0, ${futureTs(seedConfigV2.futureMs)}, ${pastTs(360)})`,
    );

    const blockedIds = generateIds(totalBlocked);
    if (fanOutBlockedJobIds.length < 10) {
      fanOutBlockedJobIds.push(...blockedIds.slice(0, 10 - fanOutBlockedJobIds.length));
    }
    await bulkInsertJobs(
      blockedIds,
      "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, created_at",
      (id, i) =>
        `('${id}', '${tierBlockedName}', '${id}', '${tierBlockedName}', 0, '${JSON.stringify({ index: i })}', 1, ${pastTs(120)})`,
    );

    // Each blocker blocks its own slice (round-robin assignment)
    for (let start = 0; start < blockedIds.length; start += CHUNK) {
      const chunk = blockedIds.slice(start, start + CHUNK);
      const rows = chunk.map(
        (jobId, ci) => `('${jobId}', '${blockerIds[(start + ci) % blockerCount]}', 0)`,
      );
      await exec(
        `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, "index") VALUES ${rows.join(", ")}`,
      );
    }

    fanOutBlockedCount += totalBlocked;
  }

  // --- Block: Non-independent chains ---
  const nonIndependentCount = seedConfigV2.nonIndependent * scale;
  const nonIndependentIds = generateIds(nonIndependentCount);
  await bulkInsertJobs(
    nonIndependentIds,
    "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, created_at",
    (id, i) =>
      `('${id}', 'seed:nonindep', '${id}', 'seed:nonindep', 0, '${JSON.stringify({ index: i })}', 1, ${pastTs(60)})`,
  );

  for (let start = 0; start < nonIndependentIds.length; start += CHUNK) {
    const chunk = nonIndependentIds.slice(start, start + CHUNK);
    const rows = chunk.map((jobId) => `('${jobId}', '${fanInBlockerChainIds[0]}', 0)`);
    await exec(
      `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, "index") VALUES ${rows.join(", ")}`,
    );
  }

  // --- Block: Long chain with continuations ---
  const chainLength = seedConfigV2.chainLength * scale;
  const chainJobIds = generateIds(chainLength);
  const chainId = chainJobIds[0];

  for (let step = 0; step < chainLength; step++) {
    const id = chainJobIds[step];
    const isLast = step === chainLength - 1;
    if (isLast) {
      await exec(
        `INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked, created_at)
         VALUES ('${id}', 'seed:chain', '${chainId}', 'seed:chain', ${step}, '${JSON.stringify({ n: step })}', 0, ${pastTs(180)})`,
      );
    } else {
      await exec(
        `INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked, attempt, completed_at, completed_by, created_at)
         VALUES ('${id}', 'seed:chain', '${chainId}', 'seed:chain', ${step}, '${JSON.stringify({ n: step })}', 0, 1, ${pastTs(180)}, '${seedConfigV2.workerId}', ${pastTs(180)})`,
      );
    }
  }

  for (let step = 0; step < chainLength - 1; step++) {
    await exec(
      `UPDATE ${job} SET continued_to_id = '${chainJobIds[step + 1]}' WHERE id = '${chainJobIds[step]}'`,
    );
  }

  // --- Block: Throwaway pending ---
  const throwawayPendingIds = generateIds(seedConfigV2.throwawayPending * scale);
  await bulkInsertJobs(
    throwawayPendingIds,
    "id, type_name, chain_id, chain_type_name, chain_index, input, blocked",
    (id, i) =>
      `('${id}', 'seed:throwaway:pending', '${id}', 'seed:throwaway:pending', 0, '${JSON.stringify({ index: i })}', 0)`,
  );

  // --- Block: Throwaway running ---
  const throwawayRunningIds = generateIds(seedConfigV2.throwawayRunning * scale);
  await bulkInsertJobs(
    throwawayRunningIds,
    "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, attempt, attempt_at, attempt_by, attempt_until",
    (id, i) =>
      `('${id}', 'seed:throwaway:running', '${id}', 'seed:throwaway:running', 0, '${JSON.stringify({ index: i })}', 0, 1, datetime('now', 'subsec'), '${seedConfigV2.workerId}', ${futureTs(seedConfigV2.attemptMs)})`,
  );

  // --- Block: Throwaway expired running ---
  const throwawayExpiredIds = generateIds(seedConfigV2.throwawayExpiredRunning * scale);
  await bulkInsertJobs(
    throwawayExpiredIds,
    "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, attempt, attempt_at, attempt_by, attempt_until, created_at",
    (id, i) =>
      `('${id}', 'seed:throwaway:expired', '${id}', 'seed:throwaway:expired', 0, '${JSON.stringify({ index: i })}', 0, 1, ${pastTs(600)}, '${seedConfigV2.workerId}', ${pastTs(300)}, ${pastTs(900)})`,
  );

  // --- Block: Throwaway chains ---
  const throwawayChainIds = generateIds(seedConfigV2.throwawayChains * scale);
  await bulkInsertJobs(
    throwawayChainIds,
    "id, type_name, chain_id, chain_type_name, chain_index, input, blocked",
    (id, i) =>
      `('${id}', 'seed:throwaway:chain', '${id}', 'seed:throwaway:chain', 0, '${JSON.stringify({ index: i })}', 0)`,
  );

  // --- Block: Throwaway cascade chains ---
  const throwawayCascadeParentIds = generateIds(seedConfigV2.throwawayCascadeChains * scale);
  await bulkInsertJobs(
    throwawayCascadeParentIds,
    "id, type_name, chain_id, chain_type_name, chain_index, input, blocked",
    (id, i) =>
      `('${id}', 'seed:throwaway:cascade-parent', '${id}', 'seed:throwaway:cascade-parent', 0, '${JSON.stringify({ index: i })}', 0)`,
  );

  const throwawayCascadeChildIds = generateIds(seedConfigV2.throwawayCascadeChains * scale);
  await bulkInsertJobs(
    throwawayCascadeChildIds,
    "id, type_name, chain_id, chain_type_name, chain_index, input, blocked",
    (id, i) =>
      `('${id}', 'seed:throwaway:cascade-child', '${id}', 'seed:throwaway:cascade-child', 0, '${JSON.stringify({ index: i })}', 1)`,
  );

  const cascadeBlockerRows = throwawayCascadeChildIds.map(
    (childId, i) => `('${childId}', '${throwawayCascadeParentIds[i]}', 0)`,
  );
  await exec(
    `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, "index") VALUES ${cascadeBlockerRows.join(", ")}`,
  );

  // --- Block: Throwaway unblockers ---
  const throwawayUnblockerIds = generateIds(seedConfigV2.throwawayUnblockers * scale);
  await bulkInsertJobs(
    throwawayUnblockerIds,
    "id, type_name, chain_id, chain_type_name, chain_index, input, blocked, scheduled_at",
    (id, i) =>
      `('${id}', 'seed:throwaway:unblocker', '${id}', 'seed:throwaway:unblocker', 0, '${JSON.stringify({ index: i })}', 0, ${futureTs(seedConfigV2.futureMs)})`,
  );

  const throwawayUnblockTargetIds = generateIds(seedConfigV2.throwawayUnblockers * scale);
  await bulkInsertJobs(
    throwawayUnblockTargetIds,
    "id, type_name, chain_id, chain_type_name, chain_index, input, blocked",
    (id, i) =>
      `('${id}', 'seed:throwaway:unblock-target', '${id}', 'seed:throwaway:unblock-target', 0, '${JSON.stringify({ index: i })}', 1)`,
  );

  const unblockerRows = throwawayUnblockTargetIds.map(
    (targetId, i) => `('${targetId}', '${throwawayUnblockerIds[i]}', 0)`,
  );
  await exec(
    `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, "index") VALUES ${unblockerRows.join(", ")}`,
  );

  return {
    pending: {
      jobId: pendingIds[seedConfigV2.pendingTypes[0]][0],
      typeNames: [...seedConfigV2.pendingTypes],
    },
    scheduled: {
      jobId: scheduledIds[0],
      typeName: "seed:scheduled",
    },
    running: {
      jobId: runningIds[seedConfigV2.runningTypes[0]][0],
      typeNames: [...seedConfigV2.runningTypes],
    },
    completed: {
      jobId: completedIds[seedConfigV2.completedTypes[0]][0],
      typeNames: [...seedConfigV2.completedTypes],
    },
    retried: {
      jobId: retriedIds[0],
      typeName: "seed:retried",
    },
    longChain: {
      chainId,
      length: chainLength,
      headJobId: chainJobIds[0],
      tailJobId: chainJobIds[chainLength - 1],
    },
    fanIn: {
      blockerChainIds: fanInBlockerChainIds,
      blockedCount: fanInBlockedCount,
      blockersPerJob: seedConfigV2.fanInTiers[seedConfigV2.fanInTiers.length - 1].blockers,
      blockedJobId: fanInBlockedJobId!,
    },
    fanOut: {
      blockerChainId: fanOutBlockerChainId!,
      blockedJobIds: fanOutBlockedJobIds,
      blockedCount: fanOutBlockedCount,
    },
    nonIndependent: {
      chainId: nonIndependentIds[0],
      count: nonIndependentCount,
    },
    throwaway: {
      pendingTypeName: "seed:throwaway:pending",
      runningTypeName: "seed:throwaway:running",
      expiredRunningTypeName: "seed:throwaway:expired",
      chainIds: throwawayChainIds,
      cascadeChainIds: throwawayCascadeParentIds,
      unblockerChainIds: throwawayUnblockerIds,
    },
  };
};
