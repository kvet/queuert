/**
 * Memory Footprint Measurement Entry Point
 *
 * Measures memory footprint of Queuert components across different adapters.
 * Each measurement runs in a separate child process for complete isolation.
 *
 * Usage:
 *   pnpm start:all                # Run all adapter measurements
 *   pnpm start:state-postgres     # Run PostgreSQL state adapter measurement
 *   pnpm start:state-sqlite       # Run SQLite state adapter measurement
 *   pnpm start:notify-redis       # Run Redis notify adapter measurement
 *   pnpm start:notify-postgres    # Run PostgreSQL notify adapter measurement
 *   pnpm start:notify-nats        # Run NATS notify adapter measurement
 *   pnpm start:otel               # Run OpenTelemetry observability adapter measurement
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

const measurementModules: Record<string, string> = {
  "state-postgres": "state-postgres.ts",
  "state-sqlite": "state-sqlite.ts",
  "notify-redis": "notify-redis.ts",
  "notify-postgres": "notify-postgres.ts",
  "notify-nats": "notify-nats.ts",
  otel: "otel.ts",
};

async function runMeasurementInChildProcess(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const modulePath = measurementModules[name];
    if (!modulePath) {
      reject(new Error(`Unknown measurement: ${name}`));
      return;
    }

    const fullPath = join(__dirname, modulePath);

    // Spawn a new Node.js process with --expose-gc and tsx loader
    const child = spawn("node", ["--expose-gc", "--import=tsx", fullPath], {
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
        reject(new Error(`Measurement ${name} exited with code ${code}`));
      }
    });
  });
}

async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              QUEUERT MEMORY FOOTPRINT MEASUREMENT              ║");
  console.log("║          (Each measurement runs in a separate process)         ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  let toRun: string[] = [];

  if (args.includes("--all")) {
    toRun = Object.keys(measurementModules);
  } else if (args.includes("--state-postgres")) {
    toRun = ["state-postgres"];
  } else if (args.includes("--state-sqlite")) {
    toRun = ["state-sqlite"];
  } else if (args.includes("--notify-redis")) {
    toRun = ["notify-redis"];
  } else if (args.includes("--notify-postgres")) {
    toRun = ["notify-postgres"];
  } else if (args.includes("--notify-nats")) {
    toRun = ["notify-nats"];
  } else if (args.includes("--otel")) {
    toRun = ["otel"];
  } else {
    console.log("\nUsage: pnpm start:<measurement>");
    console.log("\nAvailable measurements:");
    for (const name of Object.keys(measurementModules)) {
      console.log(`  --${name}`);
    }
    console.log("  --all (run all measurements)");
    process.exit(0);
  }

  for (const name of toRun) {
    console.log(`\n>>> Running measurement: ${name} (in child process)\n`);
    await runMeasurementInChildProcess(name);
    console.log("");
  }

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                      MEASUREMENT COMPLETE                      ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
}

await main().catch((error: unknown) => {
  console.error("Measurement failed:", error);
  process.exit(1);
});
