import { randomUUID } from "node:crypto";

import { createRedisStateAdapter } from "@queuert/redis";
import { createRedisStateAdapter as createLegacyRedisStateAdapter } from "@queuert/redis-schema-v1";
import { loadStateDump } from "@queuert/redis-schema-v1/conformance-internal";
import { RedisContainer } from "@testcontainers/redis";
import { createIoredisStateProvider } from "example-redis-state-ioredis/provider";
import { Redis } from "ioredis";

import {
  assertLegacyCore,
  createLog,
  createMeasured,
  datasetCells,
  scaleLabel,
  seconds,
  seedsFor,
  tableSpecs,
  writeMigrationResults,
} from "./results.ts";
import { createIoredisStateProvider as createLegacyIoredisStateProvider } from "./schema-v1/provider.ioredis.ts";
import { type Seed, parseScales } from "./seed.ts";
import { verifyFence, verifySeedReadback } from "./verify.ts";

assertLegacyCore("@queuert/redis-schema-v1");

const scales = parseScales();
const log = createLog("Redis", "Redis 8, ioredis");
const { report } = log;
const { measured, set } = createMeasured();

console.log("\nStarting Redis container...");
const container = await new RedisContainer("redis:8")
  .withExposedPorts(6379)
  .withResourcesQuota({ memory: 4, cpu: 8 })
  .start();
const client = new Redis(container.getConnectionUrl());

const run = async (seed: Seed) => {
  await client.flushall();
  const legacyProvider = createLegacyIoredisStateProvider({ client });
  const legacyAdapter = createLegacyRedisStateAdapter({ stateProvider: legacyProvider });
  await legacyAdapter.migrateToLatest();
  const loadStart = performance.now();
  await loadStateDump(legacyProvider, seed.dump, { offsetMs: seed.offsetMs });
  const memory = /used_memory_human:(\S+)/.exec(await client.info("memory"))?.[1];
  report(
    `  ${scaleLabel(seed.scale)}: loaded as schema v1 in ${seconds(performance.now() - loadStart)}s, ${await client.dbsize()} keys, ${memory}`,
  );

  const base = createIoredisStateProvider({ client });
  let rewriteStart: number | undefined;
  const stateAdapter = createRedisStateAdapter({
    stateProvider: {
      ...base,
      eval: async (script, keys, args) => {
        if (rewriteStart === undefined && script.includes("ZSCAN"))
          rewriteStart = performance.now();
        return base.eval(script, keys, args);
      },
    },
  });
  const start = performance.now();
  const result = await stateAdapter.migrateToLatest();
  const totalMs = performance.now() - start;
  if (!result.applied.includes("002_schema_v2") || result.applied.includes("001_schema_fence_v1")) {
    throw new Error(`Unexpected migration result: ${JSON.stringify(result)}`);
  }
  const blockingMs = (rewriteStart ?? start) - start;
  report(
    `    migrateToLatest ${seconds(totalMs)}s: fence and blocking flags ${seconds(blockingMs)}s, consecutiveFailures rewrite ${seconds(totalMs - blockingMs)}s`,
  );
  set(tableSpecs.redisPhases, scaleLabel(seed.scale), {
    "Blocking flags": seconds(blockingMs),
    "consecutiveFailures rewrite": seconds(totalMs - blockingMs),
  });

  const violations =
    log.reportChecks(
      `read back ${seed.dump.jobs.length} seeded jobs`,
      await verifySeedReadback({
        readJobs: async (jobIds) => stateAdapter.getJobs({ jobIds }),
        readBlockers: async (jobIds) => stateAdapter.getJobsBlockers({ jobIds }),
        seed,
        repairs: { releasesOrphans: false, unblocksStranded: false },
      }),
    ) +
    log.reportChecks(
      "fence",
      await verifyFence({
        legacyWrite: async () =>
          legacyAdapter.withTransaction(async (txCtx) =>
            legacyAdapter.createJobs({
              txCtx,
              jobs: [{ id: randomUUID(), typeName: "fence:legacy", input: null }],
            }),
          ),
        currentWrite: async () =>
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: randomUUID(), typeName: "fence:current", input: null }],
            }),
          ),
      }),
    );
  return { totalMs, violations };
};

log.start();
let violations = 0;
for (const { seed, counts } of seedsFor(scales, report)) {
  set(tableSpecs.dataset, scaleLabel(seed.scale), datasetCells(counts));
  const idle = await run(seed);
  violations += idle.violations;
  set(tableSpecs.idle, scaleLabel(seed.scale), { Redis: seconds(idle.totalMs) });
  report("");
}

log.write();
client.disconnect();
await container.stop();
writeMigrationResults({ backend: "Redis", scales, measured });
if (violations > 0) {
  throw new Error(`${violations} invariant checks failed after 002_schema_v2 on Redis`);
}
