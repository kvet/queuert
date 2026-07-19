import { type BaseTxContext } from "queuert";
import { type SeedSentinelsV2, seedConfigV2 } from "queuert/testing";

import { type PgStateProvider } from "../state-provider/state-provider.pg.js";

export const fastSeedAllStatesV2 = async <TTxContext extends BaseTxContext>(
  stateProvider: PgStateProvider<TTxContext>,
  {
    scale = 1,
    schema = "public",
    tablePrefix = "queuert_",
  }: { scale?: number; schema?: string; tablePrefix?: string } = {},
): Promise<SeedSentinelsV2> => {
  const job = `${schema}.${tablePrefix}job`;
  const blockerTable = `${schema}.${tablePrefix}job_blocker`;

  const exec = async (sql: string, params: unknown[] = []) =>
    stateProvider.executeSql({
      sql,
      params,
      paramTypes: {},
      columnTypes: {},
      readOnly: false,
    }) as Promise<Record<string, unknown>[]>;

  // --- Block: Pending jobs (created at t=base, earliest createdAt) ---
  const pendingIds: Record<string, string> = {};
  for (const typeName of seedConfigV2.pendingTypes) {
    const count = seedConfigV2.pendingPerType * scale;
    const rows = await exec(
      `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
       INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked, created_at)
       SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false,
              now() - interval '10 minutes'
       FROM ids RETURNING id`,
      [typeName, count],
    );
    pendingIds[typeName] = rows[0]?.id as string;
  }

  // --- Block: Scheduled ---
  const [{ id: scheduledJobId }] = await exec(
    `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
     INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked, scheduled_at, created_at)
     SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false,
            now() + interval '${seedConfigV2.futureMs} milliseconds',
            now() - interval '10 minutes'
     FROM ids RETURNING id`,
    ["seed:scheduled", seedConfigV2.scheduledCount * scale],
  );

  // --- Block: Running ---
  const runningIds: Record<string, string> = {};
  for (const typeName of seedConfigV2.runningTypes) {
    const count = seedConfigV2.runningPerType * scale;
    const rows = await exec(
      `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
       INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked,
                           attempt, attempt_at, attempt_by, attempt_until, created_at)
       SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false,
              1, now(), '${seedConfigV2.workerId}', now() + interval '${seedConfigV2.attemptMs} milliseconds',
              now() - interval '9 minutes'
       FROM ids RETURNING id`,
      [typeName, count],
    );
    runningIds[typeName] = rows[0]?.id as string;
  }

  // --- Block: Completed (non-continued, created at t=base-8min) ---
  const completedIds: Record<string, string> = {};
  for (const typeName of seedConfigV2.completedTypes) {
    const count = seedConfigV2.completedPerType * scale;
    const rows = await exec(
      `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
       INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked,
                           attempt, completed_at, completed_by, output, created_at)
       SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false,
              1, now() - interval '5 minutes', '${seedConfigV2.workerId}',
              jsonb_build_object('ok', true, 'index', ids.i),
              now() - interval '8 minutes'
       FROM ids RETURNING id`,
      [typeName, count],
    );
    completedIds[typeName] = rows[0]?.id as string;
  }

  // --- Block: Retried ---
  const [{ id: retriedJobId }] = await exec(
    `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
     INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked,
                         attempt, last_attempt_at, last_attempt_error, scheduled_at, created_at)
     SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false,
            1, now(), '"seeded transient failure"'::jsonb,
            now() + interval '${seedConfigV2.futureMs} milliseconds',
            now() - interval '7 minutes'
     FROM ids RETURNING id`,
    ["seed:retried", seedConfigV2.retriedCount * scale],
  );

  // --- Block: Fan-in (tiered: many×1, medium×10, few×100) ---
  const fanInBlockerChainIds: string[] = [];
  let fanInBlockedJobId: string | undefined;
  let fanInBlockedCount = 0;

  for (const tier of seedConfigV2.fanInTiers) {
    const blockedCount = tier.blocked * scale;
    const blockerCount = tier.blockers;
    const tierName = `seed:blocked:fanin:${blockerCount}`;
    const tierBlockerName = `seed:blocker:gate:${blockerCount}`;

    // Create blocker chains for this tier
    const blockerRows = await exec(
      `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
       INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked,
                           scheduled_at, created_at)
       SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false,
              now() + interval '${seedConfigV2.futureMs} milliseconds',
              now() - interval '6 minutes'
       FROM ids RETURNING id`,
      [tierBlockerName, blockerCount],
    );
    fanInBlockerChainIds.push(...blockerRows.map((r) => r.id as string));

    // Create blocked jobs
    await exec(
      `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $1 - 1) AS gs(i))
       INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked, created_at)
       SELECT ids.id, $2, ids.id, $2, 0, jsonb_build_object('index', ids.i), true,
              now() - interval '2 minutes'
       FROM ids`,
      [blockedCount, tierName],
    );

    // Link each blocked job to all blockers in this tier (cross join)
    await exec(
      `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, "index")
       SELECT j.id, b.id, b.idx
       FROM ${job} j
       CROSS JOIN (SELECT id, row_number() OVER () - 1 AS idx FROM ${job} WHERE type_name = $1) b
       WHERE j.type_name = $2`,
      [tierBlockerName, tierName],
    );

    fanInBlockedCount += blockedCount;
    if (!fanInBlockedJobId) {
      const [row] = await exec(`SELECT id FROM ${job} WHERE type_name = $1 LIMIT 1`, [tierName]);
      fanInBlockedJobId = row.id as string;
    }
  }

  // --- Block: Fan-out (tiered: 1 blocker→1000 jobs, 10→100, 100→10) ---
  let fanOutBlockerChainId: string | undefined;
  const fanOutBlockedJobIds: string[] = [];
  let fanOutBlockedCount = 0;

  for (const tier of seedConfigV2.fanOutTiers) {
    const blockerCount = tier.blockers * scale;
    const blockedPerBlocker = tier.blockedPer;
    const totalBlocked = blockerCount * blockedPerBlocker;
    const tierBlockerName = `seed:blocker:fanout:${tier.blockers}`;
    const tierBlockedName = `seed:blocked:fanout:${tier.blockers}`;

    // Create blocker chains
    const blockerRows = await exec(
      `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
       INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked,
                           scheduled_at, created_at)
       SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false,
              now() + interval '${seedConfigV2.futureMs} milliseconds',
              now() - interval '6 minutes'
       FROM ids RETURNING id`,
      [tierBlockerName, blockerCount],
    );
    fanOutBlockerChainId ??= blockerRows[0].id as string;

    // Create blocked jobs
    await exec(
      `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $1 - 1) AS gs(i))
       INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked, created_at)
       SELECT ids.id, $2, ids.id, $2, 0, jsonb_build_object('index', ids.i), true,
              now() - interval '2 minutes'
       FROM ids`,
      [totalBlocked, tierBlockedName],
    );

    // Each blocker blocks its own slice of blockedPer jobs (round-robin assignment)
    await exec(
      `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, "index")
       SELECT j.id, b.id, 0
       FROM (SELECT id, row_number() OVER () - 1 AS rn FROM ${job} WHERE type_name = $2) j
       JOIN (SELECT id, row_number() OVER () - 1 AS rn FROM ${job} WHERE type_name = $1) b
         ON b.rn = j.rn % $3`,
      [tierBlockerName, tierBlockedName, blockerCount],
    );

    fanOutBlockedCount += totalBlocked;
    if (fanOutBlockedJobIds.length < 10) {
      const rows = await exec(`SELECT id FROM ${job} WHERE type_name = $1 LIMIT $2`, [
        tierBlockedName,
        10 - fanOutBlockedJobIds.length,
      ]);
      fanOutBlockedJobIds.push(...rows.map((r) => r.id as string));
    }
  }

  // --- Block: Non-independent chains (created AFTER independent ones) ---
  const nonIndependentCount = seedConfigV2.nonIndependent * scale;
  await exec(
    `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $1 - 1) AS gs(i))
     INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked, created_at)
     SELECT ids.id, 'seed:nonindep', ids.id, 'seed:nonindep', 0,
            jsonb_build_object('index', ids.i), true,
            now() - interval '1 minute'
     FROM ids`,
    [nonIndependentCount],
  );

  await exec(
    `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, "index")
     SELECT j.id, $1, 0 FROM ${job} j WHERE j.type_name = 'seed:nonindep'`,
    [fanInBlockerChainIds[0]],
  );

  const [{ id: nonIndependentChainId }] = await exec(
    `SELECT chain_id AS id FROM ${job} WHERE type_name = 'seed:nonindep' LIMIT 1`,
  );

  // --- Block: Long chain with continuations ---
  const chainLength = seedConfigV2.chainLength * scale;
  const chainIds = await exec(
    `WITH RECURSIVE chain_gen(step, id, prev_id) AS (
       SELECT 0, gen_random_uuid(), NULL::uuid
       UNION ALL
       SELECT step + 1, gen_random_uuid(), id FROM chain_gen WHERE step < $1 - 1
     )
     SELECT step, id, prev_id FROM chain_gen ORDER BY step`,
    [chainLength],
  );

  const chainId = chainIds[0].id as string;
  const chainHeadJobId = chainIds[0].id as string;
  const chainTailJobId = chainIds[chainIds.length - 1].id as string;

  for (const row of chainIds) {
    const step = row.step as number;
    const isLast = step === chainLength - 1;
    if (isLast) {
      await exec(
        `INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked, created_at)
         VALUES ($1, 'seed:chain', $2, 'seed:chain', $3, $4, false, now() - interval '3 minutes')`,
        [row.id, chainId, step, JSON.stringify({ n: step })],
      );
    } else {
      await exec(
        `INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked,
                             attempt, completed_at, completed_by, created_at)
         VALUES ($1, 'seed:chain', $2, 'seed:chain', $3, $4, false, 1, now() - interval '3 minutes', '${seedConfigV2.workerId}',
                 now() - interval '3 minutes')`,
        [row.id, chainId, step, JSON.stringify({ n: step })],
      );
    }
  }

  for (const row of chainIds) {
    const step = row.step as number;
    if (step < chainLength - 1) {
      await exec(`UPDATE ${job} SET continued_to_id = $1 WHERE id = $2`, [
        chainIds[step + 1].id,
        row.id,
      ]);
    }
  }

  // --- Block: Throwaway pending ---
  await exec(
    `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
     INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked)
     SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false
     FROM ids RETURNING id`,
    ["seed:throwaway:pending", seedConfigV2.throwawayPending * scale],
  );

  // --- Block: Throwaway running ---
  await exec(
    `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
     INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked,
                         attempt, attempt_at, attempt_by, attempt_until)
     SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false,
            1, now(), '${seedConfigV2.workerId}', now() + interval '${seedConfigV2.attemptMs} milliseconds'
     FROM ids RETURNING id`,
    ["seed:throwaway:running", seedConfigV2.throwawayRunning * scale],
  );

  // --- Block: Throwaway expired running (attempt_until in the past for reclaimExpiredJobAttempt) ---
  await exec(
    `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
     INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked,
                         attempt, attempt_at, attempt_by, attempt_until, created_at)
     SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false,
            1, now() - interval '10 minutes', '${seedConfigV2.workerId}', now() - interval '5 minutes',
            now() - interval '15 minutes'
     FROM ids RETURNING id`,
    ["seed:throwaway:expired", seedConfigV2.throwawayExpiredRunning * scale],
  );

  // --- Block: Throwaway chains (for deleteChains) ---
  const throwawayChainRows = await exec(
    `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
     INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked)
     SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false
     FROM ids RETURNING id`,
    ["seed:throwaway:chain", seedConfigV2.throwawayChains * scale],
  );

  // --- Block: Throwaway cascade chains (parent blocks a child, for deleteChains cascade) ---
  const throwawayCascadeRows = await exec(
    `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
     INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked)
     SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false
     FROM ids RETURNING id`,
    ["seed:throwaway:cascade-parent", seedConfigV2.throwawayCascadeChains * scale],
  );

  // Create children blocked by each cascade parent
  await exec(
    `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
     INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked)
     SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), true
     FROM ids`,
    ["seed:throwaway:cascade-child", seedConfigV2.throwawayCascadeChains * scale],
  );

  const cascadeChildRows = await exec(
    `SELECT id FROM ${job} WHERE type_name = 'seed:throwaway:cascade-child' ORDER BY created_at`,
  );
  for (let i = 0; i < throwawayCascadeRows.length; i++) {
    await exec(
      `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, "index") VALUES ($1, $2, 0)`,
      [cascadeChildRows[i].id, throwawayCascadeRows[i].id],
    );
  }

  // --- Block: Throwaway unblockers (chains that block a target, for unblockJobs) ---
  const throwawayUnblockerRows = await exec(
    `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
     INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked,
                         scheduled_at)
     SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), false,
            now() + interval '${seedConfigV2.futureMs} milliseconds'
     FROM ids RETURNING id`,
    ["seed:throwaway:unblocker", seedConfigV2.throwawayUnblockers * scale],
  );

  // Create targets blocked by each unblocker
  await exec(
    `WITH ids AS (SELECT gen_random_uuid() AS id, gs.i FROM generate_series(0, $2 - 1) AS gs(i))
     INSERT INTO ${job} (id, type_name, chain_id, chain_type_name, chain_index, input, blocked)
     SELECT ids.id, $1, ids.id, $1, 0, jsonb_build_object('index', ids.i), true
     FROM ids`,
    ["seed:throwaway:unblock-target", seedConfigV2.throwawayUnblockers * scale],
  );

  const targetRows = await exec(
    `SELECT id FROM ${job} WHERE type_name = 'seed:throwaway:unblock-target' ORDER BY created_at`,
  );
  for (let i = 0; i < throwawayUnblockerRows.length; i++) {
    await exec(
      `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, "index") VALUES ($1, $2, 0)`,
      [targetRows[i].id, throwawayUnblockerRows[i].id],
    );
  }

  return {
    pending: {
      jobId: pendingIds[seedConfigV2.pendingTypes[0]],
      typeNames: [...seedConfigV2.pendingTypes],
    },
    scheduled: {
      jobId: scheduledJobId as string,
      typeName: "seed:scheduled",
    },
    running: {
      jobId: runningIds[seedConfigV2.runningTypes[0]],
      typeNames: [...seedConfigV2.runningTypes],
    },
    completed: {
      jobId: completedIds[seedConfigV2.completedTypes[0]],
      typeNames: [...seedConfigV2.completedTypes],
    },
    retried: {
      jobId: retriedJobId as string,
      typeName: "seed:retried",
    },
    longChain: {
      chainId,
      length: chainLength,
      headJobId: chainHeadJobId,
      tailJobId: chainTailJobId,
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
      chainId: nonIndependentChainId as string,
      count: nonIndependentCount,
    },
    throwaway: {
      pendingTypeName: "seed:throwaway:pending",
      runningTypeName: "seed:throwaway:running",
      expiredRunningTypeName: "seed:throwaway:expired",
      chainIds: throwawayChainRows.map((r) => r.id as string),
      cascadeChainIds: throwawayCascadeRows.map((r) => r.id as string),
      unblockerChainIds: throwawayUnblockerRows.map((r) => r.id as string),
    },
  };
};
