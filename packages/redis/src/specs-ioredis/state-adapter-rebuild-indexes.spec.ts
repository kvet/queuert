// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { acquireRedis, acquireRedisCluster } from "@queuert/testcontainers";
import { Cluster, Redis } from "ioredis";
import { it as baseIt, describe, expect } from "vitest";

import { rebuildIndexes } from "../migration-store/rebuild-indexes.redis.ts";
import { createRedisSchema, indexKeyHeads } from "../state-adapter/schema.redis.ts";
import {
  type RedisStateAdapter,
  createRedisStateAdapter,
} from "../state-adapter/state-adapter.redis.ts";
import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";
import { createIoredisClusterStateProvider } from "./state-provider.ioredis-cluster.ts";
import { createIoredisStateProvider } from "./state-provider.ioredis.ts";

const redis = await acquireRedis("redis:6");
const redisCluster = await acquireRedisCluster("redis:6");

const DUMP_SCRIPT = `
local dump = {}
local cursor = '0'
repeat
  local result = redis.call('SCAN', cursor, 'MATCH', ARGV[1], 'COUNT', 1000)
  cursor = result[1]
  for _, key in ipairs(result[2]) do
    local keyType = redis.call('TYPE', key).ok
    local value
    if keyType == 'zset' then
      value = redis.call('ZRANGE', key, 0, -1, 'WITHSCORES')
    elseif keyType == 'set' then
      value = redis.call('SMEMBERS', key)
    elseif keyType == 'hash' then
      value = redis.call('HGETALL', key)
    else
      value = { redis.call('GET', key) }
    end
    table.insert(dump, { key, keyType, value })
  end
until cursor == '0'
return dump
`;

const CORRUPT_SCRIPT = `
local prefix = ARGV[1]
local cursor = '0'
repeat
  local result = redis.call('SCAN', cursor, 'MATCH', ARGV[2], 'COUNT', 1000)
  cursor = result[1]
  for _, key in ipairs(result[2]) do
    for index = 3, #ARGV, 2 do
      local head = prefix .. ARGV[index + 1]
      if (ARGV[index] == 'exact' and key == head)
        or (ARGV[index] == 'prefix' and string.sub(key, 1, #head) == head) then
        redis.call('DEL', key)
        break
      end
    end
  end
until cursor == '0'
redis.call('ZADD', prefix .. 'due:provision-account', 0, '0000000000000000|ghost')
redis.call('ZADD', prefix .. 'jobs:createdAt:all:ghost-type', 1, 'ghost')
redis.call('HSET', prefix .. 'job-type-names', 'ghost-type', 3)
redis.call('SADD', prefix .. 'blocked-by:ghost-chain', 'ghost')
redis.call('HSET', prefix .. 'set-versions', prefix .. 'blocked-by:ghost-chain', 1)
redis.call('HSET', prefix .. 'set-versions', prefix .. 'blocked-by:gone-chain', 1)
return 1
`;

type Dump = Record<string, [string, unknown]>;

const pairsOf = (flat: string[]): [string, string][] =>
  Array.from({ length: flat.length / 2 }, (_, index) => [flat[index * 2], flat[index * 2 + 1]]);

const readDump = async (stateProvider: RedisStateProvider, keyPrefix: string): Promise<Dump> => {
  const entries = (await stateProvider.eval(
    DUMP_SCRIPT,
    [`${keyPrefix}sequence`],
    [`${keyPrefix}*`],
  )) as [string, string, string[]][];
  return Object.fromEntries(
    entries.map(([key, type, value]) => [
      key,
      [
        type,
        type === "zset"
          ? pairsOf(value)
          : type === "set"
            ? value.toSorted()
            : type === "hash"
              ? Object.fromEntries(pairsOf(value))
              : value,
      ],
    ]),
  );
};

const page = { limit: 100 };
const typeNames = [
  "provision-account",
  "render-invoice-pdf",
  "capture-payment",
  "ship-order",
  "sync-to-crm",
  "send-welcome-email",
  "daily-digest",
];

const readAll = async (stateAdapter: RedisStateAdapter, workerIds: string[]) => ({
  jobTypeNames: (await stateAdapter.getJobTypeNames({})).toSorted(),
  chainTypeNames: (await stateAdapter.getChainTypeNames({})).toSorted(),
  jobCounts: await stateAdapter.countJobsByTypeName({ typeNames }),
  chainCounts: await stateAdapter.countChainsByTypeName({ typeNames }),
  workerCounts: await stateAdapter.countWorkers({}),
  workerCountsByType: await stateAdapter.countWorkersByTypeName({ typeNames }),
  runningByWorker: await stateAdapter.countRunningJobsByWorkerId({ workerIds }),
  jobs: await Promise.all(
    typeNames.flatMap((typeName) =>
      (
        [
          { status: undefined, orderBy: "createdAt" },
          { status: "blocked", orderBy: "scheduledAt" },
          { status: "pending", orderBy: "scheduledAt" },
          { status: "pending", orderBy: "createdAt" },
          { status: "running", orderBy: "attemptAt" },
          { status: "completed", orderBy: "completedAt" },
        ] as const
      ).map(async (filter) =>
        stateAdapter.listJobs({ typeName, orderDirection: "asc", page, ...filter }),
      ),
    ),
  ),
  chains: await Promise.all(
    typeNames.flatMap((typeName) =>
      [undefined, true, false].map(async (independent) =>
        stateAdapter.listChains({
          typeName,
          independent,
          orderBy: "createdAt",
          orderDirection: "desc",
          page,
        }),
      ),
    ),
  ),
  completedChains: await Promise.all(
    typeNames.map(async (typeName) =>
      stateAdapter.listChains({
        typeName,
        status: "completed",
        orderBy: "completedAt",
        orderDirection: "asc",
        page,
      }),
    ),
  ),
  workers: await stateAdapter.listWorkers({ orderDirection: "asc", page }),
  workersOfType: await stateAdapter.listWorkers({
    typeName: "render-invoice-pdf",
    orderDirection: "asc",
    page,
  }),
  workerJobs: await Promise.all(
    workerIds.map(async (workerId) =>
      stateAdapter.listWorkerJobs({ workerId, orderDirection: "asc", page }),
    ),
  ),
});

const buildState = async (stateAdapter: RedisStateAdapter) => {
  const create = async (
    typeName: string,
    options: Partial<Parameters<RedisStateAdapter["createJobs"]>[0]["jobs"][number]> = {},
  ) => {
    const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
      stateAdapter.createJobs({
        txCtx,
        jobs: [
          { id: stateAdapter.config.generateJobId(), typeName, input: { typeName }, ...options },
        ],
      }),
    );
    return chain.head.id;
  };

  await create("provision-account", { traceContext: "trace-provision" });
  await create("render-invoice-pdf", { schedule: { afterMs: 3_600_000 } });
  const blockerChainId = await create("capture-payment");
  const blockedJobId = await create("ship-order");
  await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.addJobsBlockers({
      txCtx,
      jobBlockers: [{ jobId: blockedJobId, blockedByChainIds: [blockerChainId] }],
    }),
  );
  await create("daily-digest", { deduplication: { key: "today", scope: "running" } });
  const deletedChainId = await create("daily-digest");
  await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.deleteChains({ txCtx, chainIds: [deletedChainId] }),
  );

  const crmWorker = await stateAdapter.startWorker({
    workerId: stateAdapter.config.generateWorkerId(),
    typeNames: ["sync-to-crm", "send-welcome-email"],
    concurrency: 4,
    leaseMs: 60_000,
  });
  const pdfWorker = await stateAdapter.startWorker({
    workerId: stateAdapter.config.generateWorkerId(),
    typeNames: ["render-invoice-pdf"],
    concurrency: 1,
    leaseMs: 60_000,
  });
  for (let index = 0; index < 4; index++) await create("sync-to-crm");
  await create("send-welcome-email");
  const claimed = await stateAdapter.startJobAttempts({
    workerId: crmWorker.id,
    workerToken: crmWorker.token,
    typeNames: ["sync-to-crm", "send-welcome-email"],
    limit: 4,
  });
  const [completed, continued, rescheduled] = claimed;
  await stateAdapter.withTransaction(async (txCtx) => {
    await stateAdapter.completeJobs({
      txCtx,
      jobs: [
        {
          jobId: completed.id,
          output: { done: true },
          attemptToken: completed.attemptToken!,
          workerId: crmWorker.id,
        },
      ],
    });
    await stateAdapter.continueJobs({
      txCtx,
      jobs: [
        {
          id: stateAdapter.config.generateJobId(),
          typeName: "send-welcome-email",
          input: null,
          continueFromId: continued.id,
          attemptToken: continued.attemptToken!,
          workerId: crmWorker.id,
        },
      ],
    });
    await stateAdapter.rescheduleJobs({
      txCtx,
      jobs: [{ jobId: rescheduled.id, attemptToken: rescheduled.attemptToken!, error: "boom" }],
    });
  });
  return { workerIds: [crmWorker.id, pdfWorker.id] };
};

const withoutVersions = (dump: Dump, keyPrefix: string): Dump =>
  Object.fromEntries(
    Object.entries(dump).filter(
      ([key]) => key !== `${keyPrefix}set-versions` && key !== `${keyPrefix}sequence`,
    ),
  );

const targets = [
  {
    name: "standalone",
    connect: () => {
      const client = new Redis(redis.connectionUrl);
      return {
        stateProvider: createIoredisStateProvider({ client }),
        quit: async () => client.quit(),
      };
    },
  },
  {
    name: "cluster",
    connect: () => {
      const cluster = new Cluster(redisCluster.rootNodes.map((node) => node.url));
      return {
        stateProvider: createIoredisClusterStateProvider({ cluster }),
        quit: async () => cluster.quit(),
      };
    },
  },
];

describe.each(targets)("Redis index rebuild ($name)", { timeout: 60_000 }, ({ connect }) => {
  const it = baseIt.extend("setup", async ({}, { onCleanup }) => {
    const { stateProvider, quit } = connect();
    const keyPrefix = `{queuert-${crypto.randomUUID()}}:`;
    const stateAdapter = createRedisStateAdapter({ stateProvider, keyPrefix });
    onCleanup(async () => {
      await stateAdapter.close();
      await quit();
    });
    await stateAdapter.migrateToLatest();
    const schema = createRedisSchema(keyPrefix);
    const rebuild = async (assertLockHeld: () => void = () => {}) =>
      rebuildIndexes({ stateProvider, schema, assertLockHeld, batchSize: 200 });
    const dump = async () => readDump(stateProvider, keyPrefix);
    const corrupt = async () =>
      stateProvider.eval(
        CORRUPT_SCRIPT,
        [schema.keys.sequence],
        [
          keyPrefix,
          `${keyPrefix}*`,
          ...indexKeyHeads.flatMap(({ exact, head }) => [exact ? "exact" : "prefix", head]),
        ],
      );
    return { keyPrefix, stateAdapter, rebuild, dump, corrupt };
  });

  it("changes nothing on a keyspace whose indexes match its records", async ({ setup }) => {
    await buildState(setup.stateAdapter);
    const before = await setup.dump();

    await setup.rebuild();

    expect(await setup.dump()).toEqual(before);
  });

  it("restores dropped and corrupted indexes from the records", async ({ setup }) => {
    const { stateAdapter, keyPrefix } = setup;
    const { workerIds } = await buildState(stateAdapter);
    const reads = await readAll(stateAdapter, workerIds);
    const before = await setup.dump();
    const setVersionsKey = `${keyPrefix}set-versions`;
    const blockedByKeys = Object.keys(before[setVersionsKey][1] as Record<string, string>).filter(
      (key) => key.startsWith(`${keyPrefix}blocked-by:`),
    );

    await setup.corrupt();
    expect(await readAll(stateAdapter, workerIds)).not.toEqual(reads);
    await setup.rebuild();

    const after = await setup.dump();
    expect(withoutVersions(after, keyPrefix)).toEqual(withoutVersions(before, keyPrefix));
    const versionsBefore = before[setVersionsKey][1] as Record<string, string>;
    const versionsAfter = after[setVersionsKey][1] as Record<string, string>;
    expect(Object.keys(versionsAfter).toSorted()).toEqual(Object.keys(versionsBefore).toSorted());
    expect(blockedByKeys).toHaveLength(1);
    for (const key of blockedByKeys) {
      expect(Number(versionsAfter[key])).toBeGreaterThan(Number(versionsBefore[key]));
    }
    expect(await readAll(stateAdapter, workerIds)).toEqual(reads);
  });

  it("claims the same jobs after a rebuild", async ({ setup }) => {
    const { stateAdapter } = setup;
    await buildState(stateAdapter);
    const due = (
      await Promise.all(
        typeNames.map(async (typeName) =>
          stateAdapter.listJobs({
            typeName,
            status: "pending",
            orderBy: "scheduledAt",
            to: new Date(),
            orderDirection: "asc",
            page,
          }),
        ),
      )
    ).flatMap(({ items }) => items.map((job) => job.id));
    const worker = await stateAdapter.startWorker({
      workerId: stateAdapter.config.generateWorkerId(),
      typeNames,
      concurrency: 100,
      leaseMs: 60_000,
    });

    await setup.corrupt();
    await setup.rebuild();
    const claimed = await stateAdapter.startJobAttempts({
      workerId: worker.id,
      workerToken: worker.token,
      typeNames,
      limit: 100,
    });

    expect(due.length).toBeGreaterThan(0);
    expect(claimed.map((job) => job.id).toSorted()).toEqual(due.toSorted());
  });

  it("stops when the migration lease is lost and completes when run again", async ({ setup }) => {
    await buildState(setup.stateAdapter);
    const before = await setup.dump();
    await setup.corrupt();
    let checks = 0;

    await expect(
      setup.rebuild(() => {
        if (++checks > 6) throw new Error("lease lost");
      }),
    ).rejects.toThrow("lease lost");
    await setup.rebuild();

    const after = await setup.dump();
    expect(withoutVersions(after, setup.keyPrefix)).toEqual(
      withoutVersions(before, setup.keyPrefix),
    );
  });
});
