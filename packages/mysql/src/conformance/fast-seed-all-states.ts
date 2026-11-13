import { randomUUID } from "node:crypto";

import type { BaseTxContext } from "queuert";
import { type SeedSentinels, seedConfig } from "queuert/conformance-internal";

import type { MysqlStateProvider } from "../state-provider/state-provider.mysql.ts";

type JobRow = {
  id: string;
  type_name: string;
  chain_id: string;
  chain_index: number;
  continued_to_id?: string;
  input: string;
  output?: string;
  status: "blocked" | "pending" | "running" | "completed";
  chain_status?: "running" | "completed";
  attempt: number;
  created_at: string;
  scheduled_at: string;
  attempt_at?: string;
  attempt_by?: string;
  attempt_token?: string;
  completed_at?: string;
  completed_by?: string;
  last_attempt_at?: string;
  last_attempt_error?: string;
  chain_completed_at?: string;
};

type BlockerRow = { job_id: string; blocked_by_chain_id: string; index: number };

const CHUNK_SIZE = 5_000;

const chunks = <T>(items: T[]): T[][] =>
  Array.from({ length: Math.ceil(items.length / CHUNK_SIZE) }, (_, chunk) =>
    items.slice(chunk * CHUNK_SIZE, (chunk + 1) * CHUNK_SIZE),
  );

const formatTimestamp = (date: Date): string => date.toISOString().slice(0, 23).replace("T", " ");

export const fastSeedAllStates = async <TTxContext extends BaseTxContext>(
  stateProvider: MysqlStateProvider<TTxContext>,
  { scale = 1, tablePrefix = "queuert_" }: { scale?: number; tablePrefix?: string } = {},
): Promise<SeedSentinels> => {
  const job = `${tablePrefix}job`;
  const blockerTable = `${tablePrefix}job_blocker`;
  const workerTable = `${tablePrefix}worker`;

  const exec = async (sql: string, params: unknown[] = []) =>
    stateProvider.executeSql({
      sql,
      params,
      paramTypes: {},
      columnTypes: {},
      readOnly: false,
    }) as Promise<Record<string, unknown>[]>;

  const [{ now: serverNow }] = await exec("SELECT CAST(UTC_TIMESTAMP(6) AS CHAR) AS now");
  const nowMs = new Date(`${String(serverNow).slice(0, 23).replace(" ", "T")}Z`).getTime();
  const at = (offsetMs: number): string => formatTimestamp(new Date(nowMs + offsetMs));
  const minutes = (count: number): number => count * 60_000;
  const now = at(0);
  const future = at(seedConfig.futureMs);

  const insertJobs = async (rows: JobRow[]): Promise<void> => {
    for (const chunk of chunks(rows)) {
      await exec(
        `INSERT INTO ${job} (id, type_name, chain_id, chain_index, continued_to_id, input, output, status, chain_status,
                             attempt, created_at, scheduled_at, attempt_at, attempt_by, attempt_token, completed_at,
                             completed_by, last_attempt_at, last_attempt_error, chain_completed_at)
         SELECT d.id, d.type_name, d.chain_id, d.chain_index, d.continued_to_id, JSON_EXTRACT(d.input, '$'),
                JSON_EXTRACT(d.output, '$'), d.status, d.chain_status, d.attempt, d.created_at, d.scheduled_at,
                d.attempt_at, d.attempt_by, d.attempt_token, d.completed_at, d.completed_by, d.last_attempt_at,
                JSON_EXTRACT(d.last_attempt_error, '$'), d.chain_completed_at
         FROM JSON_TABLE(?, '$[*]' COLUMNS (
           id CHAR(36) CHARACTER SET ascii PATH '$.id',
           type_name VARCHAR(255) CHARACTER SET utf8mb4 PATH '$.type_name',
           chain_id CHAR(36) CHARACTER SET ascii PATH '$.chain_id',
           chain_index INT PATH '$.chain_index',
           continued_to_id CHAR(36) CHARACTER SET ascii PATH '$.continued_to_id',
           input LONGTEXT CHARACTER SET utf8mb4 PATH '$.input',
           output LONGTEXT CHARACTER SET utf8mb4 PATH '$.output',
           status VARCHAR(16) CHARACTER SET ascii PATH '$.status',
           chain_status VARCHAR(16) CHARACTER SET ascii PATH '$.chain_status',
           attempt INT PATH '$.attempt',
           created_at DATETIME(6) PATH '$.created_at',
           scheduled_at DATETIME(6) PATH '$.scheduled_at',
           attempt_at DATETIME(6) PATH '$.attempt_at',
           attempt_by CHAR(36) CHARACTER SET ascii PATH '$.attempt_by',
           attempt_token CHAR(36) CHARACTER SET ascii PATH '$.attempt_token',
           completed_at DATETIME(6) PATH '$.completed_at',
           completed_by CHAR(36) CHARACTER SET ascii PATH '$.completed_by',
           last_attempt_at DATETIME(6) PATH '$.last_attempt_at',
           last_attempt_error LONGTEXT CHARACTER SET utf8mb4 PATH '$.last_attempt_error',
           chain_completed_at DATETIME(6) PATH '$.chain_completed_at'
         )) d`,
        [JSON.stringify(chunk)],
      );
    }
  };

  const insertBlockers = async (rows: BlockerRow[]): Promise<void> => {
    for (const chunk of chunks(rows)) {
      await exec(
        `INSERT INTO ${blockerTable} (job_id, blocked_by_chain_id, \`index\`)
         SELECT d.job_id, d.blocked_by_chain_id, d.blocker_index
         FROM JSON_TABLE(?, '$[*]' COLUMNS (
           job_id CHAR(36) CHARACTER SET ascii PATH '$.job_id',
           blocked_by_chain_id CHAR(36) CHARACTER SET ascii PATH '$.blocked_by_chain_id',
           blocker_index INT PATH '$.index'
         )) d`,
        [JSON.stringify(chunk)],
      );
    }
  };

  const heads = (
    typeName: string,
    count: number,
    fields: (index: number) => Partial<JobRow>,
  ): JobRow[] =>
    Array.from({ length: count }, (_, index) => {
      const id = randomUUID();
      return {
        id,
        type_name: typeName,
        chain_id: id,
        chain_index: 0,
        input: JSON.stringify({ index }),
        status: "pending",
        chain_status: "running",
        attempt: 0,
        created_at: now,
        scheduled_at: now,
        ...fields(index),
      };
    });

  const insertWorker = async (
    id: string,
    typeNames: readonly string[],
    startedAt: string,
    leaseUntil: string,
  ): Promise<void> => {
    await exec(
      `INSERT INTO ${workerTable} (id, type_names, concurrency, started_at, lease_until, token)
       VALUES (?, JSON_EXTRACT(?, '$'), ?, ?, ?, ?)`,
      [
        id,
        JSON.stringify(typeNames),
        seedConfig.workerConcurrency,
        startedAt,
        leaseUntil,
        randomUUID(),
      ],
    );
  };

  await insertWorker(seedConfig.workerId, seedConfig.workerTypeNames, now, at(seedConfig.leaseMs));
  for (const idleWorker of seedConfig.idleWorkers) {
    await insertWorker(idleWorker.id, idleWorker.typeNames, now, at(seedConfig.leaseMs));
  }
  await insertWorker(
    seedConfig.busyWorkerId,
    seedConfig.busyWorkerTypeNames,
    now,
    at(seedConfig.leaseMs),
  );
  await insertWorker(
    seedConfig.expiredWorkerId,
    seedConfig.expiredWorkerTypeNames,
    at(-minutes(15)),
    at(-minutes(5)),
  );

  // --- Block: Pending jobs (created at t=base, earliest createdAt) ---
  const pendingIds: Record<string, string> = {};
  for (const typeName of seedConfig.pendingTypes) {
    const rows = heads(typeName, seedConfig.pendingPerType * scale, () => ({
      created_at: at(-minutes(10)),
    }));
    await insertJobs(rows);
    pendingIds[typeName] = rows[0].id;
  }

  // --- Block: Scheduled ---
  const scheduledRows = heads("seed:scheduled", seedConfig.scheduledCount * scale, () => ({
    scheduled_at: future,
    created_at: at(-minutes(10)),
  }));
  await insertJobs(scheduledRows);

  // --- Block: Running ---
  const runningIds: Record<string, string> = {};
  for (const typeName of seedConfig.runningTypes) {
    const rows = heads(typeName, seedConfig.runningPerType * scale, () => ({
      status: "running",
      attempt: 1,
      attempt_at: now,
      attempt_by: seedConfig.workerId,
      attempt_token: randomUUID(),
      created_at: at(-minutes(9)),
    }));
    await insertJobs(rows);
    runningIds[typeName] = rows[0].id;
  }

  // --- Block: Completed (non-continued, created at t=base-8min) ---
  const completedIds: Record<string, string> = {};
  for (const typeName of seedConfig.completedTypes) {
    const rows = heads(typeName, seedConfig.completedPerType * scale, (index) => ({
      status: "completed",
      chain_status: "completed",
      attempt: 1,
      completed_at: at(-minutes(5)),
      completed_by: seedConfig.workerId,
      output: JSON.stringify({ ok: true, index }),
      chain_completed_at: at(-minutes(5)),
      created_at: at(-minutes(8)),
    }));
    await insertJobs(rows);
    completedIds[typeName] = rows[0].id;
  }

  // --- Block: Retried ---
  const retriedRows = heads("seed:retried", seedConfig.retriedCount * scale, () => ({
    attempt: 1,
    last_attempt_at: now,
    last_attempt_error: JSON.stringify("seeded transient failure"),
    scheduled_at: future,
    created_at: at(-minutes(7)),
  }));
  await insertJobs(retriedRows);

  // --- Block: Fan-in (tiered: many×1, medium×10, few×100) ---
  const fanInBlockerChainIds: string[] = [];
  let fanInBlockedJobId: string | undefined;
  let fanInBlockedCount = 0;

  for (const tier of seedConfig.fanInTiers) {
    const blockerRows = heads(`seed:blocker:gate:${tier.blockers}`, tier.blockers, () => ({
      scheduled_at: future,
      created_at: at(-minutes(6)),
    }));
    await insertJobs(blockerRows);
    fanInBlockerChainIds.push(...blockerRows.map((row) => row.id));

    const blockedRows = heads(`seed:blocked:fanin:${tier.blockers}`, tier.blocked * scale, () => ({
      status: "blocked",
      created_at: at(-minutes(2)),
    }));
    await insertJobs(blockedRows);
    await insertBlockers(
      blockedRows.flatMap((blocked) =>
        blockerRows.map((blocker, index) => ({
          job_id: blocked.id,
          blocked_by_chain_id: blocker.id,
          index,
        })),
      ),
    );

    fanInBlockedCount += blockedRows.length;
    fanInBlockedJobId ??= blockedRows[0].id;
  }

  // --- Block: Fan-out (tiered: 1 blocker→1000 jobs, 10→100, 100→10) ---
  let fanOutBlockerChainId: string | undefined;
  const fanOutBlockedJobIds: string[] = [];
  let fanOutBlockedCount = 0;

  for (const tier of seedConfig.fanOutTiers) {
    const blockerRows = heads(
      `seed:blocker:fanout:${tier.blockers}`,
      tier.blockers * scale,
      () => ({ scheduled_at: future, created_at: at(-minutes(6)) }),
    );
    await insertJobs(blockerRows);
    fanOutBlockerChainId ??= blockerRows[0].id;

    const blockedRows = heads(
      `seed:blocked:fanout:${tier.blockers}`,
      blockerRows.length * tier.blockedPer,
      () => ({ status: "blocked", created_at: at(-minutes(2)) }),
    );
    await insertJobs(blockedRows);
    await insertBlockers(
      blockedRows.map((blocked, index) => ({
        job_id: blocked.id,
        blocked_by_chain_id: blockerRows[index % blockerRows.length].id,
        index: 0,
      })),
    );

    fanOutBlockedCount += blockedRows.length;
    fanOutBlockedJobIds.push(
      ...blockedRows.slice(0, 10 - fanOutBlockedJobIds.length).map((row) => row.id),
    );
  }

  // --- Block: Non-independent chains (created AFTER independent ones) ---
  const nonIndependentRows = heads("seed:nonindep", seedConfig.nonIndependent * scale, () => ({
    status: "blocked",
    created_at: at(-minutes(1)),
  }));
  await insertJobs(nonIndependentRows);
  await insertBlockers(
    nonIndependentRows.map((row) => ({
      job_id: row.id,
      blocked_by_chain_id: fanInBlockerChainIds[0],
      index: 0,
    })),
  );

  // --- Block: Long chain with continuations ---
  const chainLength = seedConfig.chainLength * scale;
  const chainJobIds = Array.from({ length: chainLength }, () => randomUUID());
  const chainId = chainJobIds[0];
  await insertJobs(
    chainJobIds.map((id, step): JobRow => {
      const isLast = step === chainLength - 1;
      return {
        id,
        type_name: "seed:chain",
        chain_id: chainId,
        chain_index: step,
        continued_to_id: isLast ? undefined : chainJobIds[step + 1],
        input: JSON.stringify({ n: step }),
        status: isLast ? "pending" : "completed",
        chain_status: step === 0 ? "running" : undefined,
        attempt: isLast ? 0 : 1,
        completed_at: isLast ? undefined : at(-minutes(3)),
        completed_by: isLast ? undefined : seedConfig.workerId,
        created_at: at(-minutes(3)),
        scheduled_at: now,
      };
    }),
  );

  // --- Block: Throwaway pending ---
  await insertJobs(
    heads("seed:throwaway:pending", seedConfig.throwawayPending * scale, () => ({})),
  );

  // --- Block: Throwaway running ---
  await insertJobs(
    heads("seed:throwaway:running", seedConfig.throwawayRunning * scale, () => ({
      status: "running",
      attempt: 1,
      attempt_at: now,
      attempt_by: seedConfig.workerId,
      attempt_token: randomUUID(),
    })),
  );

  // --- Block: Busy worker (running jobs bounded by its concurrency) ---
  await insertJobs(
    heads("seed:busy", seedConfig.workerConcurrency, () => ({
      status: "running",
      attempt: 1,
      attempt_at: now,
      attempt_by: seedConfig.busyWorkerId,
      attempt_token: randomUUID(),
    })),
  );

  // --- Block: Throwaway expired running (held by the expired worker) ---
  await insertJobs(
    heads("seed:throwaway:expired", seedConfig.throwawayExpiredRunning * scale, () => ({
      status: "running",
      attempt: 1,
      attempt_at: at(-minutes(10)),
      attempt_by: seedConfig.expiredWorkerId,
      attempt_token: randomUUID(),
      created_at: at(-minutes(15)),
    })),
  );

  // --- Block: Throwaway chains (for deleteChains) ---
  const throwawayChainRows = heads(
    "seed:throwaway:chain",
    seedConfig.throwawayChains * scale,
    () => ({}),
  );
  await insertJobs(throwawayChainRows);

  // --- Block: Throwaway unblockers (chains that block a target, for unblockJobs) ---
  const throwawayUnblockerRows = heads(
    "seed:throwaway:unblocker",
    seedConfig.throwawayUnblockers * scale,
    () => ({ scheduled_at: future }),
  );
  await insertJobs(throwawayUnblockerRows);
  const targetRows = heads(
    "seed:throwaway:unblock-target",
    seedConfig.throwawayUnblockers * scale,
    () => ({ status: "blocked" }),
  );
  await insertJobs(targetRows);
  await insertBlockers(
    targetRows.map((target, index) => ({
      job_id: target.id,
      blocked_by_chain_id: throwawayUnblockerRows[index].id,
      index: 0,
    })),
  );

  return {
    pending: {
      jobId: pendingIds[seedConfig.pendingTypes[0]],
      typeNames: [...seedConfig.pendingTypes],
    },
    scheduled: { jobId: scheduledRows[0].id, typeName: "seed:scheduled" },
    running: {
      jobId: runningIds[seedConfig.runningTypes[0]],
      typeNames: [...seedConfig.runningTypes],
    },
    completed: {
      jobId: completedIds[seedConfig.completedTypes[0]],
      typeNames: [...seedConfig.completedTypes],
    },
    retried: { jobId: retriedRows[0].id, typeName: "seed:retried" },
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
    nonIndependent: { chainId: nonIndependentRows[0].id, count: nonIndependentRows.length },
    workers: {
      idleWorkerIds: seedConfig.idleWorkers.map((idleWorker) => idleWorker.id),
      busyWorkerId: seedConfig.busyWorkerId,
    },
    throwaway: {
      pendingTypeName: "seed:throwaway:pending",
      runningTypeName: "seed:throwaway:running",
      expiredRunningTypeName: "seed:throwaway:expired",
      chainIds: throwawayChainRows.map((row) => row.id),
      unblockerChainIds: throwawayUnblockerRows.map((row) => row.id),
    },
  };
};
