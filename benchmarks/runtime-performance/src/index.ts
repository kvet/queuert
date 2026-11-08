/**
 * Runtime Performance Measurement Entry Point
 *
 * Measures memory footprint and CPU/allocation profiles of Queuert components across different adapters.
 * Each adapter runs each phase in a separate child process for complete isolation.
 */

import { execSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

const measurementModules: Record<string, string> = {
  "state-postgres": "state-postgres.ts",
  "state-sqlite": "state-sqlite.ts",
  "notify-redis": "notify-redis.ts",
  "notify-postgres": "notify-postgres.ts",
  "notify-nats": "notify-nats.ts",
  otel: "otel.ts",
  dashboard: "dashboard.ts",
  "validation-define": "validation-define.ts",
  "validation-zod": "validation-zod.ts",
  "validation-valibot": "validation-valibot.ts",
  "validation-typebox": "validation-typebox.ts",
  "validation-arktype": "validation-arktype.ts",
  "validation-codec-zod": "validation-codec-zod.ts",
  "validation-codec-superjson": "validation-codec-superjson.ts",
};

const measurementGroups: Record<string, string> = {
  validation: "validation-",
};

const phases = ["memory", "profile"];

async function runMeasurementInChildProcess(name: string, phase: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const modulePath = measurementModules[name];
    if (!modulePath) {
      reject(new Error(`Unknown measurement: ${name}`));
      return;
    }

    const fullPath = join(__dirname, modulePath);

    // Spawn a new process on the same Node.js binary with --expose-gc, bytecode flushing off (V8 would otherwise drop compiled code mid-measurement)
    // and the dist hooks, so queuert packages load from their built output
    const child = spawn(
      process.execPath,
      [
        "--expose-gc",
        "--no-flush-bytecode",
        `--import=${join(__dirname, "dist-hooks.ts")}`,
        fullPath,
        `--phase=${phase}`,
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

  for (const name of toRun) {
    for (const phase of phasesToRun) {
      console.log(`\n>>> Running measurement: ${name}, ${phase} phase (in child process)\n`);
      await runMeasurementInChildProcess(name, phase);
      console.log("");
    }
  }

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                      MEASUREMENT COMPLETE                      ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
}

await main().catch((error: unknown) => {
  console.error("Measurement failed:", error);
  process.exit(1);
});
