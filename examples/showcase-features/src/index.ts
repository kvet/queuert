/**
 * Queuert Features Showcase
 *
 * A comprehensive demonstration of Queuert features through real-world scenarios.
 *
 * Showcases included:
 * - Processing Modes: Atomic, staged, and auto-setup job processing
 * - Chain Patterns: Linear, branched, looped, and go-to execution patterns
 * - Scheduling: Recurring jobs, deduplication, and time-windowed rate limiting
 *
 * Each showcase runs independently with its own job types and processors,
 * sharing the same PostgreSQL instance and adapters.
 */

import { runChainPatternsShowcase } from "./chain-patterns.js";
import { runProcessingModesShowcase } from "./processing-modes.js";
import { runSchedulingShowcase } from "./scheduling.js";
import { createSetup } from "./setup.js";

async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║                  QUEUERT FEATURES SHOWCASE                 ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  const setup = await createSetup();

  try {
    // Run showcases sequentially
    await runProcessingModesShowcase(setup);
    await runChainPatternsShowcase(setup);
    await runSchedulingShowcase(setup);

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                    ALL SHOWCASES COMPLETE                  ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
  } finally {
    await setup.cleanup();
    console.log("\nCleanup complete!");
  }
}

main().catch((error) => {
  console.error("Showcase failed:", error);
  process.exit(1);
});
