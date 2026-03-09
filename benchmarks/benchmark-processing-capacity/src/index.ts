import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

const benchmarkModules: Record<string, string> = {
  postgres: "postgres.ts",
  sqlite: "sqlite.ts",
  "notify-redis": "notify-redis.ts",
  "notify-postgres": "notify-postgres.ts",
  "notify-nats": "notify-nats.ts",
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
  const passthrough = args.filter((a) => a.startsWith("--concurrency="));

  let toRun: string[] = [];

  const knownFlags = Object.keys(benchmarkModules);
  const selected = knownFlags.filter((name) => args.includes(`--${name}`));

  if (args.includes("--all") || selected.length === 0) {
    toRun = knownFlags;
  } else {
    toRun = selected;
  }

  for (const name of toRun) {
    console.log(`\n>>> Running benchmark: ${name} (in child process)\n`);
    await runBenchmarkInChildProcess(name, passthrough);
    console.log("");
  }
};

await main().catch((error: unknown) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
