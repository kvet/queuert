/**
 * Runtime Performance Measurement Entry Point
 *
 * Measures memory footprint and CPU/allocation profiles of Queuert components across different adapters.
 * Each adapter runs each phase in a separate child process for complete isolation.
 */

import { execSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { notMeasured } from "benchmark-results/results-file";
import { writeResultsFile } from "benchmark-results/write-results-file";

import type { MeasurementResult } from "./utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

const measurementModules: Record<string, { modulePath: string; registry?: string }> = {
  "state-postgres": { modulePath: "state-postgres.ts" },
  "state-in-process": { modulePath: "state-in-process.ts" },
  "state-in-process-async": { modulePath: "state-in-process-async.ts" },
  "state-sqlite": { modulePath: "state-sqlite.ts" },
  "state-mysql": { modulePath: "state-mysql.ts" },
  "state-mariadb": { modulePath: "state-mariadb.ts" },
  "state-redis": { modulePath: "state-redis.ts" },
  "notify-redis": { modulePath: "notify-redis.ts" },
  "notify-postgres": { modulePath: "notify-postgres.ts" },
  "notify-nats": { modulePath: "notify-nats.ts" },
  "notify-ipc": { modulePath: "notify-ipc.ts" },
  otel: { modulePath: "otel.ts" },
  dashboard: { modulePath: "dashboard.ts" },
  "validation-define": { modulePath: "validation-define.ts", registry: "defineJobTypes" },
  "validation-zod": { modulePath: "validation-zod.ts", registry: "Zod" },
  "validation-valibot": { modulePath: "validation-valibot.ts", registry: "Valibot" },
  "validation-typebox": { modulePath: "validation-typebox.ts", registry: "TypeBox" },
  "validation-arktype": { modulePath: "validation-arktype.ts", registry: "ArkType" },
  "validation-codec-zod": { modulePath: "validation-codec-zod.ts", registry: "Zod codec" },
  "validation-codec-superjson": {
    modulePath: "validation-codec-superjson.ts",
    registry: "superjson codec",
  },
};

const measurementGroups: Record<string, string> = {
  validation: "validation-",
};

const phases = ["memory", "profile"];

async function runMeasurementInChildProcess(
  name: string,
  phase: string,
  resultFile: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const measurementModule = measurementModules[name];
    if (!measurementModule) {
      reject(new Error(`Unknown measurement: ${name}`));
      return;
    }

    const fullPath = join(__dirname, measurementModule.modulePath);

    const child = spawn(
      process.execPath,
      [
        "--expose-gc",
        "--no-flush-bytecode",
        ...(phase === "profile" ? ["--enable-source-maps"] : []),
        `--import=${join(__dirname, "dist-hooks.ts")}`,
        fullPath,
        `--phase=${phase}`,
        `--result-file=${resultFile}`,
      ],
      {
        stdio: "inherit",
        env: { ...process.env },
      },
    );

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Measurement ${name} (${phase}) exited with code ${code}`));
      }
    });
  });
}

const MINIMUM_NODE_MAJOR = 24;

async function main(): Promise<void> {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `Node.js ${MINIMUM_NODE_MAJOR}+ is required (running ${process.versions.node}); see .nvmrc`,
    );
  }

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║             QUEUERT RUNTIME PERFORMANCE MEASUREMENT            ║");
  console.log("║          (Each measurement runs in a separate process)         ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  const selectedGroupPrefixes = Object.entries(measurementGroups)
    .filter(([group]) => args.includes(`--${group}`))
    .map(([, prefix]) => prefix);
  const selectedNames = Object.keys(measurementModules).filter(
    (name) =>
      args.includes(`--${name}`) || selectedGroupPrefixes.some((prefix) => name.startsWith(prefix)),
  );
  const selectedPhases = phases.filter((phase) => args.includes(`--${phase}`));
  const toRun = args.includes("--all") ? Object.keys(measurementModules) : selectedNames;
  const phasesToRun = selectedPhases.length > 0 ? selectedPhases : phases;

  if (toRun.length === 0) {
    console.log("\nUsage: pnpm start:<measurement> [--memory] [--profile]");
    console.log("\nAvailable measurements:");
    for (const name of Object.keys(measurementModules)) {
      console.log(`  --${name}`);
    }
    for (const group of Object.keys(measurementGroups)) {
      console.log(`  --${group} (run every ${measurementGroups[group]}* measurement)`);
    }
    console.log("  --all (run all measurements)");
    console.log("\nPhases (both by default):");
    console.log("  --memory   heap footprint across a build, process, close lifecycle");
    console.log("  --profile  CPU and allocation profile of the work step");
    console.log("\nOptions:");
    console.log("  --skip-build  reuse the existing dist output of the queuert packages");
    process.exit(0);
  }

  if (!args.includes("--skip-build")) {
    console.log("\nBuilding queuert packages (measurements load their dist output)...");
    execSync("pnpm --filter benchmark-runtime-performance^... build", {
      cwd: join(__dirname, "../../.."),
      stdio: "inherit",
    });
  }

  const resultDirectory = await mkdtemp(join(tmpdir(), "runtime-performance-"));
  const resultFile = join(resultDirectory, "results.jsonl");
  let results: MeasurementResult[];
  try {
    for (const name of toRun) {
      for (const phase of phasesToRun) {
        console.log(`\n>>> Running measurement: ${name}, ${phase} phase (in child process)\n`);
        await runMeasurementInChildProcess(name, phase, resultFile);
        console.log("");
      }
    }
    results = (await readFile(resultFile, "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as MeasurementResult);
  } finally {
    await rm(resultDirectory, { recursive: true, force: true });
  }

  const memoryOf = (name: string) =>
    results.find(
      (result): result is Extract<MeasurementResult, { phase: "memory" }> =>
        result.name === name && result.phase === "memory",
    );
  const profileOf = (name: string) =>
    results.find(
      (result): result is Extract<MeasurementResult, { phase: "profile" }> =>
        result.name === name && result.phase === "profile",
    );
  const adapterMeasurements = Object.entries(measurementModules)
    .filter(([, { registry }]) => registry === undefined)
    .map(([name]) => name);
  const registryMeasurements = Object.entries(measurementModules).flatMap(([name, { registry }]) =>
    registry === undefined ? [] : [{ name, registry }],
  );
  const content = writeResultsFile({
    path: join(__dirname, "../results.md"),
    title: "Runtime performance",
    ran: `${args.includes("--all") ? "all measurements" : toRun.join(", ")}${phasesToRun.length === 1 ? `, ${phasesToRun[0]} phase` : ""}`,
    tables: [
      {
        title: "Memory (KB)",
        columns: [
          "Measurement",
          "Setup",
          "In-flight peak",
          "Live JS retained",
          "JIT code retained",
        ],
        rows: adapterMeasurements.map((name) => {
          const memory = memoryOf(name);
          return [
            name,
            ...(memory === undefined
              ? Array.from({ length: 4 }, () => notMeasured)
              : [memory.setupBytes, memory.peakBytes, memory.liveJsBytes, memory.jitCodeBytes].map(
                  (bytes) => String(Math.round(bytes / 1024 / 5) * 5),
                )),
          ];
        }),
      },
      {
        title: "CPU per job (µs)",
        columns: ["Measurement", "Queuert core", "Adapter", "Dependencies", "Runtime"],
        rows: adapterMeasurements.map((name) => [
          name,
          ...["core", "adapter", "dependencies", "runtime"].map((category) => {
            const microseconds = profileOf(name)?.cpuMicrosecondsPerJob[category];
            return microseconds === undefined ? notMeasured : String(Math.round(microseconds));
          }),
        ]),
      },
      {
        title: "Allocated per job (KB)",
        columns: ["Measurement", "Allocated"],
        rows: adapterMeasurements.map((name) => {
          const bytes = profileOf(name)?.allocatedBytesPerJob;
          return [name, bytes === undefined ? notMeasured : (bytes / 1024).toFixed(1)];
        }),
      },
      {
        title: "Schema library CPU per job (µs)",
        columns: ["Registry", "Schema library"],
        rows: registryMeasurements.map(({ name, registry }) => {
          const microseconds = profileOf(name)?.cpuMicrosecondsPerJob.dependencies;
          return [registry, microseconds === undefined ? notMeasured : microseconds.toFixed(1)];
        }),
      },
      {
        title: "Allocated per job by registry (KB)",
        columns: ["Registry", "Allocated"],
        rows: registryMeasurements.map(({ name, registry }) => {
          const bytes = profileOf(name)?.allocatedBytesPerJob;
          return [registry, bytes === undefined ? notMeasured : (bytes / 1024).toFixed(1)];
        }),
      },
    ],
  });
  console.log(`\n${content}`);

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                      MEASUREMENT COMPLETE                      ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
}

await main().catch((error: unknown) => {
  console.error("Measurement failed:", error);
  process.exit(1);
});
