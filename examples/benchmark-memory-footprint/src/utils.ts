/**
 * Shared utilities for memory footprint measurements
 */

import { defineJobTypes } from "queuert";

// ============================================================================
// Memory measurement utilities
// ============================================================================

export type MemorySnapshot = {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
};

export function getMemorySnapshot(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    rss: mem.rss,
  };
}

export function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "+";
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(2)} KB`;
  return `${sign}${(abs / 1024 / 1024).toFixed(2)} MB`;
}

export function diffMemory(before: MemorySnapshot, after: MemorySnapshot): void {
  console.log("  Heap used:  ", formatBytes(after.heapUsed - before.heapUsed));
  console.log("  Heap total: ", formatBytes(after.heapTotal - before.heapTotal));
  console.log("  External:   ", formatBytes(after.external - before.external));
  console.log("  RSS:        ", formatBytes(after.rss - before.rss));
}

export async function forceGC(): Promise<void> {
  if (global.gc) {
    global.gc();
    await new Promise((resolve) => setTimeout(resolve, 50));
    global.gc();
  }
}

/**
 * Measure memory usage of an async operation.
 * Returns: [beforeSnapshot, afterSnapshot, operationResult]
 */
export async function measureMemory<T>(
  operation: () => Promise<T>,
): Promise<[MemorySnapshot, MemorySnapshot, T]> {
  await forceGC();
  const before = getMemorySnapshot();
  const result = await operation();
  await forceGC();
  const after = getMemorySnapshot();
  return [before, after, result];
}

// ============================================================================
// Console output utilities
// ============================================================================

export function printHeader(title: string): void {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log(`║${title.padStart(35 + title.length / 2).padEnd(68)}║`);
  console.log("╚════════════════════════════════════════════════════════════════╝");

  const gcAvailable = typeof global.gc === "function";
  console.log(`\nGarbage collection: ${gcAvailable ? "available (--expose-gc)" : "not exposed"}`);
  if (!gcAvailable) {
    console.log("Tip: Run with 'node --expose-gc' for more accurate measurements");
  }
}

export function printSummary(rows: [string, number][]): void {
  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  SUMMARY: Total overhead from baseline");
  console.log("───────────────────────────────────────────────────────────────");
  for (const [label, bytes] of rows) {
    console.log(`  ${label.padEnd(18)}`, formatBytes(bytes));
  }
}

export async function measureBaseline(): Promise<MemorySnapshot> {
  const [, baseline] = await measureMemory(async () => {});
  console.log("\nBaseline memory:");
  console.log("  Heap used:  ", formatBytes(baseline.heapUsed));
  return baseline;
}

// ============================================================================
// Shared job configuration
// ============================================================================

export const registry = defineJobTypes<{
  "test-job": {
    entry: true;
    input: { message: string };
    output: { processed: boolean };
  };
}>();
