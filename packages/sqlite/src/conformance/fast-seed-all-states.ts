import { randomUUID } from "node:crypto";

import { type BaseTxContext } from "queuert";
import { type SeedSentinels, seedConfig } from "queuert/testing";

import { type SqliteStateProvider } from "../state-provider/state-provider.sqlite.js";

const CHUNK = 200;

const generateIds = (count: number): string[] => Array.from({ length: count }, () => randomUUID());

const futureTs = (ms: number) => `datetime('now', 'subsec', '+${ms / 1000} seconds')`;
const pastTs = (seconds: number) => `datetime('now', 'subsec', '-${seconds} seconds')`;

export const fastSeedAllStates = async <TTxContext extends BaseTxContext>(
  stateProvider: SqliteStateProvider<TTxContext>,
  { scale = 1, tablePrefix = "queuert_" }: { scale?: number; tablePrefix?: string } = {},
): Promise<SeedSentinels> => {
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
  for (const typeName of seedConfig.pendingTypes) {
    const count = seedConfig.pendingPerType * scale;
    const ids = generateIds(count);
    pendingIds[typeName] = ids;
    await bulkInsertJobs(
      ids,
      "id, type_name, chain_id, chain_index, input, status, chain_status, created_at",
      (id, i) =>
        `('${id}', '${typeName}', '${id}', 0, '${JSON.stringify({ index: i })}', 'pending', 'running', ${pastTs(600)})`,
    );
  }

  // --- Block: Scheduled ---
  const scheduledIds = generateIds(seedConfig.scheduledCount * scale);
  await bulkInsertJobs(
    scheduledIds,
    "id, type_name, chain_id, chain_index, input, status, chain_status, scheduled_at, created_at",
    (id, i) =>
      `('${id}', 'seed:scheduled', '${id}', 0, '${JSON.stringify({ index: i })}', 'pending', 'running', ${futureTs(seedConfig.futureMs)}, ${pastTs(600)})`,
  );

  // --- Block: Running ---
  const runningIds: Record<string, string[]> = {};
  for (const typeName of seedConfig.runningTypes) {
    const count = seedConfig.runningPerType * scale;
    const ids = generateIds(count);
    runningIds[typeName] = ids;
    await bulkInsertJobs(
      ids,
      "id, type_name, chain_id, chain_index, input, status, chain_status, attempt, attempt_at, attempt_by, attempt_until, created_at",
      (id, i) =>
        `('${id}', '${typeName}', '${id}', 0, '${JSON.stringify({ index: i })}', 'running', 'running', 1, datetime('now', 'subsec'), '${seedConfig.workerId}', ${futureTs(seedConfig.attemptMs)}, ${pastTs(540)})`,
    );
  }

  // --- Block: Completed ---
  const completedIds: Record<string, string[]> = {};
  for (const typeName of seedConfig.completedTypes) {
    const count = seedConfig.completedPerType * scale;
    const ids = generateIds(count);
    completedIds[typeName] = ids;
    await bulkInsertJobs(
      ids,
      "id, type_name, chain_id, chain_index, input, status, chain_status, attempt, completed_at, completed_by, output, created_at, chain_completed_at",
      (id, i) =>
        `('${id}', '${typeName}', '${id}', 0, '${JSON.stringify({ index: i })}', 'completed', 'completed', 1, ${pastTs(300)}, '${seedConfig.workerId}', '${JSON.stringify({ ok: true, index: i })}', ${pastTs(480)}, ${pastTs(300)})`,
    );
  }

  // --- Block: Retried ---
  const retriedIds = generateIds(seedConfig.retriedCount * scale);
  await bulkInsertJobs(
    retriedIds,
    "id, type_name, chain_id, chain_index, input, status, chain_status, attempt, last_attempt_at, last_attempt_error, scheduled_at, created_at",
    (id, i) =>
      `('${id}', 'seed:retried', '${id}', 0, '${JSON.stringify({ index: i })}', 'pending', 'running', 1, datetime('now', 'subsec'), '"seeded transient failure"', ${futureTs(seedConfig.futureMs)}, ${pastTs(420)})`,
  );

  // --- Block: Fan-in (tiered) ---
  const fanInBlockerChainIds: string[] = [];
  let fanInBlockedJobId: string | undefined;
  let fanInBlockedCount = 0;

  for (const tier of seedConfig.fanInTiers) {
    const blockedCount = tier.blocked * scale;
    const blockerCount = tier.blockers;
    const tierName = `seed:blocked:fanin:${blockerCount}`;
    const tierBlockerName = `seed:blocker:gate:${blockerCount}`;

    const blockerIds = generateIds(blockerCount);
    fanInBlockerChainIds.push(...blockerIds);
    await bulkInsertJobs(
      blockerIds,
      "id, type_name, chain_id, chain_index, input, status, chain_status, scheduled_at, created_at",
      (id, i) =>
        `('${id}', '${tierBlockerName}', '${id}', 0, '${JSON.stringify({ index: i })}', 'pending', 'running', ${futureTs(seedConfig.futureMs)}, ${pastTs(360)})`,
    );

    const blockedIds = generateIds(blockedCount);
    fanInBlockedJobId ??= blockedIds[0];
    await bulkInsertJobs(
      blockedIds,
      "id, type_name, chain_id, chain_index, input, status, chain_status, created_at",
      (id, i) =>
        `('${id}', '${tierName}', '${id}', 0, '${JSON.stringify({ index: i })}', 'blocked', 'running', ${pastTs(120)})`,
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

  for (const tier of seedConfig.fanOutTiers) {
    const blockerCount = tier.blockers * scale;
    const blockedPerBlocker = tier.blockedPer;
    const totalBlocked = blockerCount * blockedPerBlocker;
    const tierBlockerName = `seed:blocker:fanout:${tier.blockers}`;
    const tierBlockedName = `seed:blocked:fanout:${tier.blockers}`;

    const blockerIds = generateIds(blockerCount);
    fanOutBlockerChainId ??= blockerIds[0];
    await bulkInsertJobs(
      blockerIds,
      "id, type_name, chain_id, chain_index, input, status, chain_status, scheduled_at, created_at",
      (id, i) =>
        `('${id}', '${tierBlockerName}', '${id}', 0, '${JSON.stringify({ index: i })}', 'pending', 'running', ${futureTs(seedConfig.futureMs)}, ${pastTs(360)})`,
    );

    const blockedIds = generateIds(totalBlocked);
    if (fanOutBlockedJobIds.length < 10) {
      fanOutBlockedJobIds.push(...blockedIds.slice(0, 10 - fanOutBlockedJobIds.length));
    }
    await bulkInsertJobs(
      blockedIds,
      "id, type_name, chain_id, chain_index, input, status, chain_status, created_at",
      (id, i) =>
        `('${id}', '${tierBlockedName}', '${id}', 0, '${JSON.stringify({ index: i })}', 'blocked', 'running', ${pastTs(120)})`,
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
  const nonIndependentCount = seedConfig.nonIndependent * scale;
  const nonIndependentIds = generateIds(nonIndependentCount);
  await bulkInsertJobs(
    nonIndependentIds,
    "id, type_name, chain_id, chain_index, input, status, chain_status, created_at",
    (id, i) =>
      `('${id}', 'seed:nonindep', '${id}', 0, '${JSON.stringify({ index: i })}', 'blocked', 'running', ${pastTs(60)})`,
  );

  for (let start = 0; start < nonIndependentIds.length; start += CHUNK) {
    const chunk = nonIndependentIds.slice(start, start + CHUNK);
    const rows = chunk.map((jobId) => `('${jobId}', '${fanInBlockerChainIds[0]}', 0)`);
    await exec(
      `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, "index") VALUES ${rows.join(", ")}`,
    );
  }

  // --- Block: Long chain with continuations ---
  const chainLength = seedConfig.chainLength * scale;
  const chainJobIds = generateIds(chainLength);
  const chainId = chainJobIds[0];

  for (let step = 0; step < chainLength; step++) {
    const id = chainJobIds[step];
    const isLast = step === chainLength - 1;
    if (isLast) {
      await exec(
        `INSERT INTO ${job} (id, type_name, chain_id, chain_index, input, status, chain_status, created_at)
         VALUES ('${id}', 'seed:chain', '${chainId}', ${step}, '${JSON.stringify({ n: step })}', 'pending', ${step === 0 ? "'running'" : "NULL"}, ${pastTs(180)})`,
      );
    } else {
      await exec(
        `INSERT INTO ${job} (id, type_name, chain_id, chain_index, input, status, chain_status, attempt, completed_at, completed_by, created_at)
         VALUES ('${id}', 'seed:chain', '${chainId}', ${step}, '${JSON.stringify({ n: step })}', 'completed', ${step === 0 ? "'running'" : "NULL"}, 1, ${pastTs(180)}, '${seedConfig.workerId}', ${pastTs(180)})`,
      );
    }
  }

  for (let step = 0; step < chainLength - 1; step++) {
    await exec(
      `UPDATE ${job} SET continued_to_id = '${chainJobIds[step + 1]}' WHERE id = '${chainJobIds[step]}'`,
    );
  }

  // --- Block: Throwaway pending ---
  const throwawayPendingIds = generateIds(seedConfig.throwawayPending * scale);
  await bulkInsertJobs(
    throwawayPendingIds,
    "id, type_name, chain_id, chain_index, input, status, chain_status",
    (id, i) =>
      `('${id}', 'seed:throwaway:pending', '${id}', 0, '${JSON.stringify({ index: i })}', 'pending', 'running')`,
  );

  // --- Block: Throwaway running ---
  const throwawayRunningIds = generateIds(seedConfig.throwawayRunning * scale);
  await bulkInsertJobs(
    throwawayRunningIds,
    "id, type_name, chain_id, chain_index, input, status, chain_status, attempt, attempt_at, attempt_by, attempt_until",
    (id, i) =>
      `('${id}', 'seed:throwaway:running', '${id}', 0, '${JSON.stringify({ index: i })}', 'running', 'running', 1, datetime('now', 'subsec'), '${seedConfig.workerId}', ${futureTs(seedConfig.attemptMs)})`,
  );

  // --- Block: Throwaway expired running ---
  const throwawayExpiredIds = generateIds(seedConfig.throwawayExpiredRunning * scale);
  await bulkInsertJobs(
    throwawayExpiredIds,
    "id, type_name, chain_id, chain_index, input, status, chain_status, attempt, attempt_at, attempt_by, attempt_until, created_at",
    (id, i) =>
      `('${id}', 'seed:throwaway:expired', '${id}', 0, '${JSON.stringify({ index: i })}', 'running', 'running', 1, ${pastTs(600)}, '${seedConfig.workerId}', ${pastTs(300)}, ${pastTs(900)})`,
  );

  // --- Block: Throwaway chains ---
  const throwawayChainIds = generateIds(seedConfig.throwawayChains * scale);
  await bulkInsertJobs(
    throwawayChainIds,
    "id, type_name, chain_id, chain_index, input, status, chain_status",
    (id, i) =>
      `('${id}', 'seed:throwaway:chain', '${id}', 0, '${JSON.stringify({ index: i })}', 'pending', 'running')`,
  );

  // --- Block: Throwaway unblockers ---
  const throwawayUnblockerIds = generateIds(seedConfig.throwawayUnblockers * scale);
  await bulkInsertJobs(
    throwawayUnblockerIds,
    "id, type_name, chain_id, chain_index, input, status, chain_status, scheduled_at",
    (id, i) =>
      `('${id}', 'seed:throwaway:unblocker', '${id}', 0, '${JSON.stringify({ index: i })}', 'pending', 'running', ${futureTs(seedConfig.futureMs)})`,
  );

  const throwawayUnblockTargetIds = generateIds(seedConfig.throwawayUnblockers * scale);
  await bulkInsertJobs(
    throwawayUnblockTargetIds,
    "id, type_name, chain_id, chain_index, input, status, chain_status",
    (id, i) =>
      `('${id}', 'seed:throwaway:unblock-target', '${id}', 0, '${JSON.stringify({ index: i })}', 'blocked', 'running')`,
  );

  const unblockerRows = throwawayUnblockTargetIds.map(
    (targetId, i) => `('${targetId}', '${throwawayUnblockerIds[i]}', 0)`,
  );
  await exec(
    `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, "index") VALUES ${unblockerRows.join(", ")}`,
  );

  return {
    pending: {
      jobId: pendingIds[seedConfig.pendingTypes[0]][0],
      typeNames: [...seedConfig.pendingTypes],
    },
    scheduled: {
      jobId: scheduledIds[0],
      typeName: "seed:scheduled",
    },
    running: {
      jobId: runningIds[seedConfig.runningTypes[0]][0],
      typeNames: [...seedConfig.runningTypes],
    },
    completed: {
      jobId: completedIds[seedConfig.completedTypes[0]][0],
      typeNames: [...seedConfig.completedTypes],
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
      blockersPerJob: seedConfig.fanInTiers[seedConfig.fanInTiers.length - 1].blockers,
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
      unblockerChainIds: throwawayUnblockerIds,
    },
  };
};
