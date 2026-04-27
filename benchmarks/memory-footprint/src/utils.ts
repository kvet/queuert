/**
 * Shared utilities for memory footprint measurements.
 *
 * The {@link runDoubleRunBenchmark} helper drives the full benchmark lifecycle:
 * a discarded warmup run (which JIT-compiles queuert code paths and triggers
 * lazy module loads in transitive dependencies) followed by a measured run
 * whose deltas are reported against an infrastructure baseline captured AFTER
 * the warmup. This isolates queuert's own steady-state heap footprint from
 * one-time runtime/module-loader noise.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as v8 from "node:v8";

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
  if (!global.gc) return;
  // Multiple GC cycles with awaits between them are needed to reach a steady
  // state: each `global.gc()` is a single mark-sweep pass, but pending
  // microtasks, finalizers, and weak-ref clearing can produce more garbage on
  // the next tick. Looping until heapUsed stabilizes (or N attempts) gives a
  // truer "what's actually retained" reading.
  let last = process.memoryUsage().heapUsed;
  for (let i = 0; i < 8; i++) {
    global.gc();
    await new Promise((resolve) => setImmediate(resolve));
    global.gc();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const cur = process.memoryUsage().heapUsed;
    if (Math.abs(cur - last) < 1024) return;
    last = cur;
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
  console.log("  SUMMARY");
  console.log("───────────────────────────────────────────────────────────────");
  for (const [label, bytes] of rows) {
    console.log(`  ${label.padEnd(28)}`, formatBytes(bytes));
  }
}

// ============================================================================
// Shared job configuration
// ============================================================================

export const jobTypes = defineJobTypes<{
  "test-job": {
    entry: true;
    input: { message: string };
    output: { processed: boolean };
  };
}>();

// ============================================================================
// Double-run benchmark scaffold
// ============================================================================

const HEAP_DUMP_DIR = path.resolve(process.cwd(), "heap-dumps");

/**
 * Capture a heap snapshot and return the live-object size, split into
 * application data (queuert objects, closures, strings, etc.) and V8/Node
 * runtime artifacts (JIT-compiled code, instruction streams, system data
 * structures).
 *
 * `process.memoryUsage().heapUsed` over-reports retention: it includes V8 heap
 * fragmentation, code arena, and internal accounting outside the live JS
 * object graph. Summing self_size across snapshot nodes is much more accurate.
 *
 * Splitting code vs non-code matters because some "retention" between two
 * snapshots is actually V8 lazily JIT-compiling code paths the warmup didn't
 * cover (e.g. driver internals only used at certain query paths). That code
 * is module-permanent — it's a one-time cost of executing the library, not a
 * leak — so the *non-code* delta is the meaningful "what queuert holds onto"
 * number.
 *
 * The snapshot is streamed in-memory via `v8.getHeapSnapshot()` and parsed
 * directly — no disk I/O unless `HEAP_DUMPS=1` is set, in which case a copy is
 * also written to `heap-dumps/` for inspection in Chrome DevTools.
 */
const captureSnapshot = async (
  name: string,
  label: string,
): Promise<{ code: number; nonCode: number }> => {
  const stream = v8.getHeapSnapshot();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");

  if (process.env.HEAP_DUMPS === "1") {
    fs.mkdirSync(HEAP_DUMP_DIR, { recursive: true });
    const filename = `${name}-${label}-${Date.now()}.heapsnapshot`;
    const fullPath = path.join(HEAP_DUMP_DIR, filename);
    fs.writeFileSync(fullPath, raw);
    console.log(`  → heap snapshot: ${fullPath}`);
  }

  return liveSizeFromSnapshotJson(raw);
};

const liveSizeFromSnapshotJson = (json: string): { code: number; nonCode: number } => {
  const snap = JSON.parse(json) as {
    snapshot: { meta: { node_fields: string[]; node_types: (string[] | string)[] } };
    nodes: number[];
  };
  const fields = snap.snapshot.meta.node_fields;
  const stride = fields.length;
  const selfSizeIdx = fields.indexOf("self_size");
  const typeFieldIdx = fields.indexOf("type");
  const nodeTypes = snap.snapshot.meta.node_types[typeFieldIdx] as string[];
  const codeTypeIdx = nodeTypes.indexOf("code");
  let code = 0;
  let nonCode = 0;
  for (let i = 0; i < snap.nodes.length; i += stride) {
    const size = snap.nodes[i + selfSizeIdx];
    if (snap.nodes[i + typeFieldIdx] === codeTypeIdx) code += size;
    else nonCode += size;
  }
  return { code, nonCode };
};

/**
 * Helpers passed to {@link DoubleRunBenchmarkOptions.runLifecycle}. During the
 * warmup run these are no-ops (so the warmup output stays quiet); during the
 * measured run they print heap deltas from the infrastructure baseline and
 * track the peak.
 */
export type LifecycleContext = {
  /** Wrap a queuert setup step: runs `fn`, logs delta from infra baseline, returns the result. */
  step: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  /** Wrap the job-processing step: same as `step` but also records the post-step heap delta as the in-flight peak. */
  processStep: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
};

export type DoubleRunBenchmarkOptions<TInfra> = {
  /** Short slug used in heap snapshot filenames (e.g. "notify-redis"). */
  name: string;
  /**
   * Sets up shared infrastructure (containers, driver clients, etc.). Called
   * once, before warmup. Should print its own per-step deltas using
   * {@link measureMemory} + {@link diffMemory}.
   */
  setupInfrastructure: () => Promise<{ infra: TInfra; teardown: () => Promise<void> }>;
  /**
   * Builds queuert adapters, does work, and closes everything. Called TWICE:
   * first as a warmup (helpers no-op), then measured. Locals defined inside
   * this function are guaranteed to go out of scope between runs, so
   * destructured refs from {@link measureMemory} will not pin adapters past
   * close.
   */
  runLifecycle: (infra: TInfra, ctx: LifecycleContext) => Promise<void>;
};

export async function runDoubleRunBenchmark<TInfra>({
  name,
  setupInfrastructure,
  runLifecycle,
}: DoubleRunBenchmarkOptions<TInfra>): Promise<void> {
  // ─── Phase 1: process baseline ───
  console.log("\n── Infrastructure setup (not queuert) ──");
  await forceGC();
  const processBaseline = getMemorySnapshot();
  console.log("\nProcess baseline:");
  console.log("  Heap used:  ", formatBytes(processBaseline.heapUsed));

  // ─── Phase 2: infrastructure setup (caller logs its own deltas) ───
  const { infra, teardown } = await setupInfrastructure();

  // ─── Phase 3: WARMUP run (discarded — warms V8 JIT + lazy module loads) ───
  // Run with the SAME ctx shape as the measured run (measureMemory + formatBytes
  // + diffMemory + console.log) so all code paths get JIT-compiled before we
  // capture the infra baseline. Output is suppressed at the stdout.write level
  // so the full console.log call chain still fires.
  console.log("\n── WARMUP run (discarded — warms V8 JIT + lazy loads) ──");
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  const warmupCtx: LifecycleContext = {
    step: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const [before, after, result] = await measureMemory(fn);
      console.log(`\n${label} (warmup):`);
      diffMemory(before, after);
      return result;
    },
    processStep: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const [before, after, result] = await measureMemory(fn);
      console.log(`\n${label} (warmup):`);
      diffMemory(before, after);
      return result;
    },
  };
  try {
    await runLifecycle(infra, warmupCtx);
  } finally {
    process.stdout.write = originalWrite;
  }

  // ─── Phase 4: infrastructure baseline established (post-warmup) ───
  await forceGC();
  const infraBaseline = getMemorySnapshot();
  console.log("\n── Infrastructure ready (post-warmup) — queuert measured from here ──");
  console.log(
    "  Infra heap above process baseline: ",
    formatBytes(infraBaseline.heapUsed - processBaseline.heapUsed),
  );
  const infraBaselineLive = await captureSnapshot(name, "infra-baseline");

  // ─── Phase 5: MEASURED run ───
  console.log("\n── MEASURED run ──");
  let peakHeapDelta = 0;
  let setupHeapDelta = 0;
  const measuredCtx: LifecycleContext = {
    step: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const [, after, result] = await measureMemory(fn);
      console.log(`\n${label} (delta from infra baseline):`);
      diffMemory(infraBaseline, after);
      return result;
    },
    processStep: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      // Heap right before the work step starts is queuert's setup overhead
      // (state + notify + client + worker, all built but no jobs yet).
      await forceGC();
      setupHeapDelta = process.memoryUsage().heapUsed - infraBaseline.heapUsed;
      const [, after, result] = await measureMemory(fn);
      console.log(`\n${label} (delta from infra baseline):`);
      diffMemory(infraBaseline, after);
      const delta = after.heapUsed - infraBaseline.heapUsed;
      if (delta > peakHeapDelta) peakHeapDelta = delta;
      return result;
    },
  };
  await runLifecycle(infra, measuredCtx);

  // ─── Phase 6: measure retention after queuert lifecycle returns ───
  await forceGC();
  const afterQueuertClose = getMemorySnapshot();
  console.log("\n── Queuert closed (lifecycle returned, GC'd) ──");
  console.log("\nDelta from infra baseline:");
  diffMemory(infraBaseline, afterQueuertClose);
  const afterCloseLive = await captureSnapshot(name, "after-queuert-close");

  // ─── Phase 7: tear down infrastructure ───
  await teardown();

  printSummary([
    ["Queuert setup overhead:", setupHeapDelta],
    ["Queuert in-flight (peak):", peakHeapDelta],
    ["After close (heapUsed):", afterQueuertClose.heapUsed - infraBaseline.heapUsed],
    ["After close (live JS objects):", afterCloseLive.nonCode - infraBaselineLive.nonCode],
    ["After close (V8 JIT code):", afterCloseLive.code - infraBaselineLive.code],
  ]);
}
