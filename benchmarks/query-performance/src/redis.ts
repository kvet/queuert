import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { type RedisStateProvider, createRedisStateAdapter } from "@queuert/redis";
import { fastSeedAllStates } from "@queuert/redis/conformance-internal";
import { RedisContainer } from "@testcontainers/redis";
import { Redis } from "ioredis";
import {
  observabilityCoverageGroups,
  operationalCoverageGroups,
} from "queuert/conformance-internal";

const ITERATIONS = 10;
const EXPLANATIONS_DIR = new URL("../explanations/redis", import.meta.url).pathname;
const RESULTS_DIR = new URL("../results", import.meta.url).pathname;
const RESULTS_FILE = `${RESULTS_DIR}/redis.txt`;
const POSTGRES_RESULTS_FILE = `${RESULTS_DIR}/postgres.txt`;
const UNCOUNTED_COMMANDS = new Set(["eval", "info", "config|resetstat"]);

const parseScale = (): number => {
  const flag = process.argv.find((argument) => argument.startsWith("--scale="));
  return flag ? parseInt(flag.split("=")[1], 10) : 100;
};

const scale = parseScale();

const stats = (times: number[]) => ({
  p50: times[Math.floor(times.length * 0.5)],
  p95: times[Math.floor(times.length * 0.95)],
  max: times[times.length - 1],
});

const formatMs = (ms: number) => `${ms.toFixed(2)}ms`;

const formatRange = (values: number[]) => {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return minimum === maximum ? `${minimum}` : `${minimum}-${maximum}`;
};

const resultLines: string[] = [];
const report = (line = "") => {
  console.log(line);
  resultLines.push(line);
};

console.log("\nStarting Redis container...");
const redisContainer = await new RedisContainer("redis:8").withExposedPorts(6379).start();
const redis = new Redis(redisContainer.getConnectionUrl());

let evalCount = 0;
const stateProvider: RedisStateProvider = {
  eval: async (script, keys, args) => {
    evalCount++;
    return redis.eval(script, keys.length, ...keys, ...args);
  },
};
const keyPrefix = "{queuert}:";
const stateAdapter = createRedisStateAdapter({ stateProvider, keyPrefix });
await stateAdapter.migrateToLatest();

const readCommandStats = async () => {
  const info = await redis.info("commandstats");
  const commands = new Map<string, { calls: number; usec: number }>();
  for (const match of info.matchAll(/^cmdstat_([^:]+):calls=(\d+),usec=(\d+)/gm)) {
    commands.set(match[1], { calls: Number(match[2]), usec: Number(match[3]) });
  }
  return commands;
};

console.log(`Seeding data (scale=${scale})...`);
const seedStart = performance.now();
const sentinels = await fastSeedAllStates(stateProvider, { scale, keyPrefix });
const seedSeconds = (performance.now() - seedStart) / 1000;
console.log(`Seed complete in ${seedSeconds.toFixed(1)}s.\n`);

const keyCount = await redis.dbsize();
const memoryInfo = await redis.info("memory");
const usedMemory = /^used_memory_human:(\S+)/m.exec(memoryInfo)?.[1] ?? "unknown";
const datasetLines = [
  `-- scale=${scale}`,
  "",
  `keys          ${keyCount}`,
  `used_memory   ${usedMemory}`,
  `seed_seconds  ${seedSeconds.toFixed(1)}`,
];
console.log(datasetLines.map((line) => `    ${line}`).join("\n"));
console.log("");

rmSync(EXPLANATIONS_DIR, { recursive: true, force: true });
mkdirSync(EXPLANATIONS_DIR, { recursive: true });
writeFileSync(`${EXPLANATIONS_DIR}/_dataset.txt`, datasetLines.join("\n") + "\n");

report("═══════════════════════════════════════════════════════════════════════════════════");
report("  QUERY PERFORMANCE — REDIS (ioredis)");
report("═══════════════════════════════════════════════════════════════════════════════════");

const summaries: {
  key: string;
  p50: number;
  p95: number;
  evals: string;
  commands: number;
  error: string | undefined;
}[] = [];

for (const group of [...operationalCoverageGroups, ...observabilityCoverageGroups]) {
  report(`  ${group.name}`);
  for (const testCase of group.cases) {
    let error: string | undefined;
    const evalCounts: number[] = [];
    const times: number[] = [];
    let commandCalls = 0;
    let serverUsec = 0;
    let commandBreakdown: [string, number][] = [];
    try {
      const instrumentedAct = await testCase.run(stateAdapter, sentinels);
      await redis.config("RESETSTAT");
      evalCount = 0;
      await instrumentedAct(stateAdapter, sentinels);
      evalCounts.push(evalCount);
      const commandStats = await readCommandStats();
      serverUsec = commandStats.get("eval")?.usec ?? 0;
      commandBreakdown = [...commandStats]
        .filter(([name]) => !UNCOUNTED_COMMANDS.has(name))
        .map(([name, { calls }]): [string, number] => [name, calls])
        .toSorted((a, b) => b[1] - a[1]);
      commandCalls = commandBreakdown.reduce((total, [, calls]) => total + calls, 0);

      for (let iteration = 0; iteration < ITERATIONS; iteration++) {
        const act = await testCase.run(stateAdapter, sentinels);
        evalCount = 0;
        const start = performance.now();
        await act(stateAdapter, sentinels);
        times.push(performance.now() - start);
        evalCounts.push(evalCount);
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    if (error !== undefined || times.length === 0) {
      report(`    ${testCase.key.padEnd(50)} ERROR: ${error ?? "no timings"}`);
      summaries.push({ key: testCase.key, p50: NaN, p95: NaN, evals: "-", commands: 0, error });
      continue;
    }

    times.sort((a, b) => a - b);
    const timing = stats(times);
    const evals = formatRange(evalCounts);
    report(
      `    ${testCase.key.padEnd(50)} p50=${formatMs(timing.p50).padStart(10)}  p95=${formatMs(timing.p95).padStart(10)}  max=${formatMs(timing.max).padStart(10)}  evals=${evals.padStart(5)}  commands=${String(commandCalls).padStart(7)}`,
    );
    summaries.push({
      key: testCase.key,
      p50: timing.p50,
      p95: timing.p95,
      evals,
      commands: commandCalls,
      error,
    });

    const content = [
      `-- ${testCase.key}`,
      `-- scale=${scale}  p50=${formatMs(timing.p50)}  p95=${formatMs(timing.p95)}  max=${formatMs(timing.max)}`,
      `-- evals=${evals}  commands=${commandCalls}  server_time=${(serverUsec / 1000).toFixed(2)}ms`,
      "",
      ...commandBreakdown.map(([name, calls]) => `${name.padEnd(24)} ${calls}`),
    ].join("\n");
    writeFileSync(`${EXPLANATIONS_DIR}/${testCase.key.replaceAll("/", "__")}.txt`, content + "\n");
  }
  report("");
}

mkdirSync(RESULTS_DIR, { recursive: true });
writeFileSync(RESULTS_FILE, [`-- scale=${scale}`, "", ...resultLines].join("\n") + "\n");
console.log(`  Results written to ${RESULTS_FILE}`);
console.log(`  Explanations written to ${EXPLANATIONS_DIR}\n`);

if (existsSync(POSTGRES_RESULTS_FILE)) {
  const postgresContent = readFileSync(POSTGRES_RESULTS_FILE, "utf8");
  const postgresScale = /^-- scale=(\d+)/.exec(postgresContent)?.[1];
  const postgresTimings = new Map(
    [...postgresContent.matchAll(/^\s+(\S+)\s+p50=\s*([\d.]+)ms\s+p95=\s*([\d.]+)ms/gm)].map(
      (match) => [match[1], { p50: Number(match[2]), p95: Number(match[3]) }] as const,
    ),
  );
  console.log(`  REDIS (scale=${scale}) vs POSTGRESQL (scale=${postgresScale ?? "?"})`);
  console.log(
    `    ${"operation".padEnd(50)} ${"redis p50".padStart(10)} ${"redis p95".padStart(10)} ${"evals".padStart(6)} ${"commands".padStart(8)} ${"pg p50".padStart(10)} ${"ratio".padStart(8)}`,
  );
  for (const summary of summaries) {
    const postgres = postgresTimings.get(summary.key);
    if (postgres === undefined) continue;
    const ratio = summary.p50 / postgres.p50;
    console.log(
      `    ${summary.key.padEnd(50)} ${formatMs(summary.p50).padStart(10)} ${formatMs(summary.p95).padStart(10)} ${summary.evals.padStart(6)} ${String(summary.commands).padStart(8)} ${formatMs(postgres.p50).padStart(10)} ${`${ratio.toFixed(2)}x`.padStart(8)}`,
    );
  }
  console.log("");
}

await stateAdapter.close();
redis.disconnect();
await redisContainer.stop();
