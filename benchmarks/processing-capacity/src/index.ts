import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type ServiceKind, startService } from "./services.js";
import { type ScenarioResult, formatRate, scenarioNames, summaryTables } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

const axes = [
  { axis: "state", title: "State adapter (in-process notify)" },
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
  "state-in-process": { modulePath: "state-in-process.ts", label: "In-process", axis: "state" },
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
  "notify-in-process": { modulePath: "notify-in-process.ts", label: "In-process", axis: "notify" },
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
  "notify-nats-nats": {
    modulePath: "notify-nats-nats.ts",
    label: "NATS",
    axis: "notify",
    service: "nats",
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

    const child = spawn("node", ["--import=tsx", fullPath, ...extraArgs], {
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
    });

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

const formatResult = (result: ScenarioResult | undefined): string => {
  if (!result) return "-";
  return `${result.drained ? ">" : "~"}${formatRate(result.count, result.durationMs)}`;
};

const formatMarkdownTable = (header: string[], rows: string[][]): string => {
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => row[index].length)),
  );
  const formatRow = (row: string[]) =>
    `| ${row.map((cell, index) => (index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index]))).join(" | ")} |`;
  const separator = `| ${widths.map((width, index) => (index === 0 ? "-".repeat(width) : `${"-".repeat(width - 1)}:`)).join(" | ")} |`;
  return [formatRow(header), separator, ...rows.map(formatRow)].join("\n");
};

const printSummary = (resultsByBenchmark: Map<string, ScenarioResult[]>): void => {
  for (const table of summaryTables) {
    const rows: string[][] = [];
    for (const { axis, title } of axes) {
      const benchmarks = Object.entries(benchmarkModules).filter(
        ([name, benchmarkModule]) =>
          benchmarkModule.axis === axis &&
          resultsByBenchmark
            .get(name)
            ?.some((result) => table.columns.some(({ scenario }) => scenario === result.scenario)),
      );
      if (benchmarks.length === 0) continue;
      rows.push([`**${title}**`, ...table.columns.map(() => "")]);
      for (const [name, { label }] of benchmarks) {
        const results = resultsByBenchmark.get(name) ?? [];
        rows.push([
          label,
          ...table.columns.map(({ scenario }) =>
            formatResult(results.find((result) => result.scenario === scenario)),
          ),
        ]);
      }
    }
    if (rows.length === 0) continue;
    console.log(`\n### ${table.title}\n`);
    console.log(formatMarkdownTable(["Adapter", ...table.columns.map(({ label }) => label)], rows));
  }
};

const main = async (): Promise<void> => {
  const scenarioArgs = args.filter((a) => a.startsWith("--scenario="));
  const runs =
    scenarioArgs.length > 0 ? scenarioArgs : scenarioNames.map((name) => `--scenario=${name}`);

  const knownFlags = Object.keys(benchmarkModules);
  const selected = knownFlags.filter((name) => args.includes(`--${name}`));

  const toRun = args.includes("--all") || selected.length === 0 ? knownFlags : selected;

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

  printSummary(resultsByBenchmark);
  console.log(`\nTotal time: ${((performance.now() - begin) / 1_000).toFixed(0)}s`);
};

await main().catch((error: unknown) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
