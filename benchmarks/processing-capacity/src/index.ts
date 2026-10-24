import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scenarioNames } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

const benchmarkModules: Record<string, string> = {
  "state-postgres-postgres-js": "state-postgres-postgres-js.ts",
  "state-postgres-pg": "state-postgres-pg.ts",
  "state-sqlite-better-sqlite3": "state-sqlite-better-sqlite3.ts",
  "state-sqlite-node-sqlite": "state-sqlite-node-sqlite.ts",
  "state-in-process": "state-in-process.ts",
  "notify-redis-redis": "notify-redis-redis.ts",
  "notify-redis-ioredis": "notify-redis-ioredis.ts",
  "notify-postgres-pg": "notify-postgres-pg.ts",
  "notify-postgres-postgres-js": "notify-postgres-postgres-js.ts",
  "notify-nats-nats": "notify-nats-nats.ts",
  "notify-in-process": "notify-in-process.ts",
};

const runBenchmarkInChildProcess = async (name: string, extraArgs: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const modulePath = benchmarkModules[name];
    if (!modulePath) {
      reject(new Error(`Unknown benchmark: ${name}`));
      return;
    }

    const fullPath = join(__dirname, modulePath);

    const child = spawn("node", ["--import=tsx", fullPath, ...extraArgs], {
      stdio: "inherit",
      env: { ...process.env },
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

const main = async (): Promise<void> => {
  const scenarioArgs = args.filter((a) => a.startsWith("--scenario="));
  const runs =
    scenarioArgs.length > 0 ? scenarioArgs : scenarioNames.map((name) => `--scenario=${name}`);

  const knownFlags = Object.keys(benchmarkModules);
  const selected = knownFlags.filter((name) => args.includes(`--${name}`));

  const toRun = args.includes("--all") || selected.length === 0 ? knownFlags : selected;

  for (const name of toRun) {
    for (const run of runs) {
      console.log(`\n>>> Running benchmark: ${name} (${run}, in child process)\n`);
      await runBenchmarkInChildProcess(name, [run]);
      console.log("");
    }
  }
};

await main().catch((error: unknown) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
