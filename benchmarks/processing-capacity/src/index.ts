import { execSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { notMeasured } from "benchmark-results/results-file";
import { writeResultsFile } from "benchmark-results/write-results-file";

import { type ServiceKind, startService } from "./services.ts";
import { type ScenarioResult, scenarioNames, summaryTables } from "./utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

const axes = [
  { axis: "state", title: "State adapter (noop notify)" },
  { axis: "notify", title: "Notify adapter (in-process state)" },
] as const;

const benchmarkModules: Record<
  string,
  {
    modulePath: string;
    label: string;
    axis: (typeof axes)[number]["axis"];
    service?: ServiceKind;
  }
> = {
  "state-in-process": {
    modulePath: "state-in-process.ts",
    label: "In-process",
    axis: "state",
  },
  "state-in-process-async": {
    modulePath: "state-in-process-async.ts",
    label: "In-process (async)",
    axis: "state",
  },
  "state-sqlite-better-sqlite3": {
    modulePath: "state-sqlite-better-sqlite3.ts",
    label: "SQLite (better-sqlite3)",
    axis: "state",
  },
  "state-sqlite-node-sqlite": {
    modulePath: "state-sqlite-node-sqlite.ts",
    label: "SQLite (node:sqlite)",
    axis: "state",
  },
  "state-postgres-postgres-js": {
    modulePath: "state-postgres-postgres-js.ts",
    label: "PostgreSQL (postgres-js)",
    axis: "state",
    service: "postgres",
  },
  "state-postgres-pg": {
    modulePath: "state-postgres-pg.ts",
    label: "PostgreSQL (pg)",
    axis: "state",
    service: "postgres",
  },
  "state-mysql-mysql2": {
    modulePath: "state-mysql-mysql2.ts",
    label: "MySQL (mysql2)",
    axis: "state",
    service: "mysql",
  },
  "state-mariadb-mariadb": {
    modulePath: "state-mariadb-mariadb.ts",
    label: "MariaDB (mariadb)",
    axis: "state",
    service: "mariadb",
  },
  "state-redis-redis": {
    modulePath: "state-redis-redis.ts",
    label: "Redis (redis)",
    axis: "state",
    service: "redis",
  },
  "state-redis-ioredis": {
    modulePath: "state-redis-ioredis.ts",
    label: "Redis (ioredis)",
    axis: "state",
    service: "redis",
  },
  "notify-in-process": {
    modulePath: "notify-in-process.ts",
    label: "In-process",
    axis: "notify",
  },
  "notify-in-process-async": {
    modulePath: "notify-in-process-async.ts",
    label: "In-process (async)",
    axis: "notify",
  },
  "notify-redis-redis": {
    modulePath: "notify-redis-redis.ts",
    label: "Redis (redis)",
    axis: "notify",
    service: "redis",
  },
  "notify-redis-ioredis": {
    modulePath: "notify-redis-ioredis.ts",
    label: "Redis (ioredis)",
    axis: "notify",
    service: "redis",
  },
  "notify-postgres-pg": {
    modulePath: "notify-postgres-pg.ts",
    label: "PostgreSQL (pg)",
    axis: "notify",
    service: "postgres",
  },
  "notify-postgres-postgres-js": {
    modulePath: "notify-postgres-postgres-js.ts",
    label: "PostgreSQL (postgres-js)",
    axis: "notify",
    service: "postgres",
  },
  "notify-nats-transport-node": {
    modulePath: "notify-nats-transport-node.ts",
    label: "NATS",
    axis: "notify",
    service: "nats",
  },
  "notify-ipc": {
    modulePath: "notify-ipc.ts",
    label: "IPC",
    axis: "notify",
  },
};

const runBenchmarkInChildProcess = async (
  name: string,
  extraArgs: string[],
  extraEnv: Record<string, string>,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const benchmarkModule = benchmarkModules[name];
    if (!benchmarkModule) {
      reject(new Error(`Unknown benchmark: ${name}`));
      return;
    }

    const fullPath = join(__dirname, benchmarkModule.modulePath);

    const child = spawn(
      process.execPath,
      [`--import=${join(__dirname, "dist-hooks.ts")}`, fullPath, ...extraArgs],
      {
        stdio: "inherit",
        env: { ...process.env, ...extraEnv },
      },
    );

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Benchmark ${name} exited with code ${code}`));
      }
    });
  });

const readResults = async (resultFile: string): Promise<ScenarioResult[]> => {
  const content = await readFile(resultFile, "utf8").catch(() => "");
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ScenarioResult);
};

const main = async (): Promise<void> => {
  const scenarioArgs = args.filter((a) => a.startsWith("--scenario="));
  const runs =
    scenarioArgs.length > 0 ? scenarioArgs : scenarioNames.map((name) => `--scenario=${name}`);

  const knownFlags = Object.keys(benchmarkModules);
  const selected = knownFlags.filter((name) => args.includes(`--${name}`));

  const toRun = args.includes("--all") || selected.length === 0 ? knownFlags : selected;

  if (!args.includes("--skip-build")) {
    console.log("\nBuilding queuert packages (benchmarks load their dist output)...");
    execSync("pnpm --filter benchmark-processing-capacity^... build", {
      cwd: join(__dirname, "../../.."),
      stdio: "inherit",
    });
  }

  const resultDirectory = await mkdtemp(join(tmpdir(), "processing-capacity-"));
  const resultsByBenchmark = new Map<string, ScenarioResult[]>();
  const services = new Map<ServiceKind, Awaited<ReturnType<typeof startService>>>();
  const begin = performance.now();
  let isolationId = 0;
  try {
    for (const name of toRun) {
      const { service } = benchmarkModules[name];
      if (service && !services.has(service)) {
        services.set(service, await startService(service));
      }
      const serviceEnv = service ? services.get(service)!.env : {};
      const resultFile = join(resultDirectory, `${name}.jsonl`);
      for (const run of runs) {
        console.log(`\n>>> Running benchmark: ${name} (${run}, in child process)\n`);
        await runBenchmarkInChildProcess(name, [run, `--result-file=${resultFile}`], {
          ...serviceEnv,
          BENCHMARK_ISOLATION_ID: String(++isolationId),
        });
        console.log("");
      }
      resultsByBenchmark.set(name, await readResults(resultFile));
    }
  } finally {
    await Promise.all(Array.from(services.values(), async ({ stop }) => stop()));
    await rm(resultDirectory, { recursive: true, force: true });
  }

  const content = writeResultsFile({
    path: join(__dirname, "../results.md"),
    title: "Processing capacity",
    ran: toRun.length === knownFlags.length ? "all adapters" : toRun.join(", "),
    tables: summaryTables.flatMap((table) =>
      axes.map(({ axis, title }) => ({
        title: `${table.title}: ${title}`,
        columns: ["Adapter", ...table.columns.map(({ label }) => label)],
        rows: Object.entries(benchmarkModules)
          .filter(([, benchmarkModule]) => benchmarkModule.axis === axis)
          .map(([name, { label }]) => [
            label,
            ...table.columns.map(({ scenario }) => {
              const result = resultsByBenchmark
                .get(name)
                ?.find((candidate) => candidate.scenario === scenario);
              return result === undefined
                ? notMeasured
                : String(Math.round(result.count / (result.durationMs / 1_000)));
            }),
          ]),
      })),
    ),
  });
  console.log(`\n${content}`);
  console.log(`\nTotal time: ${((performance.now() - begin) / 1_000).toFixed(0)}s`);
};

await main().catch((error: unknown) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
