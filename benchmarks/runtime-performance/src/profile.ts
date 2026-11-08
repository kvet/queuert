import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { HeapProfiler, Profiler } from "node:inspector";
import { Session } from "node:inspector/promises";
import { type SourceMapping, findSourceMap } from "node:module";
import { fileURLToPath } from "node:url";

import type { DoubleRunBenchmarkOptions, LifecycleContext } from "./utils.ts";

const PROFILE_JOB_COUNT = 2_000;
const CPU_SAMPLING_INTERVAL_US = 100;
const HEAP_SAMPLING_INTERVAL_BYTES = 4_096;
const TOP_FUNCTION_COUNT = 25;

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const profilesDirectory = fileURLToPath(new URL("../profiles/", import.meta.url));
const resultsDirectory = fileURLToPath(new URL("../results/profile/", import.meta.url));

export const categories = [
  "core",
  "adapter",
  "dependencies",
  "runtime",
  "harness",
  "idle",
] as const;

type Category = (typeof categories)[number];

type CallFrame = { functionName: string; url: string; lineNumber: number; columnNumber: number };

export const categorize = ({ functionName, url }: CallFrame): Category => {
  if (functionName === "(idle)") return "idle";
  if (url === "" || url.startsWith("node:")) return "runtime";
  if (url.includes("/node_modules/")) return "dependencies";
  if (url.includes("/packages/core/") || url.includes("/packages-internal/helpers/")) return "core";
  if (url.includes("/packages/") || url.includes("/packages-internal/typed-sql/")) return "adapter";
  return "harness";
};

export const functionNameAt = (line: string, column: number): string | undefined =>
  /([\w$]+)\s*[:=]\s*$/.exec(line.slice(0, column))?.[1] ??
  /^(?:async\s+)?function\s*\*?\s*([\w$]+)/.exec(line.slice(column))?.[1] ??
  /^(?:async\s+)?\*?\s*(?!async\b|function\b)([\w$]+)\s*[(<]/.exec(line.slice(column))?.[1];

const sourceLines = new Map<string, string[]>();

const readSourceLines = (url: string): string[] => {
  const lines = sourceLines.get(url) ?? readFileSync(fileURLToPath(url), "utf8").split("\n");
  sourceLines.set(url, lines);
  return lines;
};

const isSourceMapping = (entry: SourceMapping | object): entry is SourceMapping =>
  "originalSource" in entry;

const resolveCallFrame = <TCallFrame extends CallFrame>(callFrame: TCallFrame): TCallFrame => {
  const entry =
    callFrame.url.startsWith("file://") &&
    !callFrame.url.includes("/node_modules/") &&
    callFrame.lineNumber >= 0
      ? findSourceMap(callFrame.url)?.findEntry(callFrame.lineNumber, callFrame.columnNumber)
      : undefined;
  if (entry === undefined || !isSourceMapping(entry)) return callFrame;
  const originalName =
    callFrame.functionName === ""
      ? functionNameAt(
          readSourceLines(entry.originalSource)[entry.originalLine] ?? "",
          entry.originalColumn,
        )
      : callFrame.functionName;
  return {
    ...callFrame,
    functionName: originalName ?? "",
    url: entry.originalSource,
    lineNumber: entry.originalLine,
    columnNumber: entry.originalColumn,
  };
};

const resolveCpuProfile = (profile: Profiler.Profile): Profiler.Profile => ({
  ...profile,
  nodes: profile.nodes.map((node) => ({ ...node, callFrame: resolveCallFrame(node.callFrame) })),
});

const resolveHeapNode = (
  node: HeapProfiler.SamplingHeapProfileNode,
): HeapProfiler.SamplingHeapProfileNode => ({
  ...node,
  callFrame: resolveCallFrame(node.callFrame),
  children: node.children.map(resolveHeapNode),
});

const emptyTotals = (): Record<Category, number> =>
  Object.fromEntries(categories.map((category) => [category, 0])) as Record<Category, number>;

const frameKey = ({ functionName, url, lineNumber }: CallFrame): string =>
  `${functionName}\u0000${url}\u0000${lineNumber}`;

type FrameTotal = { callFrame: CallFrame; category: Category; total: number };

const totalsByFrame = (entries: { callFrame: CallFrame; amount: number }[]): FrameTotal[] => {
  const frames = new Map<string, FrameTotal>();
  for (const { callFrame, amount } of entries) {
    const key = frameKey(callFrame);
    const frame = frames.get(key) ?? { callFrame, category: categorize(callFrame), total: 0 };
    frame.total += amount;
    frames.set(key, frame);
  }
  return [...frames.values()].sort((a, b) => b.total - a.total);
};

const totalsByCategory = (frames: FrameTotal[]): Record<Category, number> => {
  const totals = emptyTotals();
  for (const { category, total } of frames) totals[category] += total;
  return totals;
};

const cumulativeSum = (start: number, deltas: number[]): number[] => {
  const sums: number[] = [];
  let running = start;
  for (const delta of deltas) {
    running += delta;
    sums.push(running);
  }
  return sums;
};

export const summarizeCpuProfile = (
  profile: Profiler.Profile,
): { byCategory: Record<Category, number>; frames: FrameTotal[] } => {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const sampleIds = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  const timestamps = cumulativeSum(profile.startTime, deltas);
  const frames = totalsByFrame(
    sampleIds.map((id, index) => ({
      callFrame: nodes.get(id)!.callFrame,
      amount: (timestamps[index + 1] ?? profile.endTime) - timestamps[index],
    })),
  );
  return { byCategory: totalsByCategory(frames), frames };
};

const flattenHeapNodes = (
  node: HeapProfiler.SamplingHeapProfileNode,
): HeapProfiler.SamplingHeapProfileNode[] => [node, ...node.children.flatMap(flattenHeapNodes)];

export const summarizeHeapProfile = (
  profile: HeapProfiler.SamplingHeapProfile,
): { byCategory: Record<Category, number>; frames: FrameTotal[] } => {
  const frames = totalsByFrame(
    flattenHeapNodes(profile.head).map((node) => ({
      callFrame: node.callFrame,
      amount: node.selfSize,
    })),
  );
  return { byCategory: totalsByCategory(frames), frames };
};

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const busyCategories = categories.filter((category) => category !== "idle");

const location = ({ url, lineNumber }: CallFrame): string =>
  url === ""
    ? "(native)"
    : `${url.replace("file://", "").replace(repositoryRoot, "")}:${lineNumber + 1}`;

const formatFrames = (frames: FrameTotal[], formatAmount: (amount: number) => string): string[] =>
  frames
    .filter(({ category }) => category !== "idle")
    .slice(0, TOP_FUNCTION_COUNT)
    .map(
      ({ callFrame, category, total }) =>
        `  ${formatAmount(total).padStart(10)}  ${category.padEnd(12)}  ${(callFrame.functionName || "(anonymous)").padEnd(40)}  ${location(callFrame)}`,
    );

export const formatProfileReport = ({
  name,
  jobCount,
  wallMs,
  processCpuUs,
  cpu,
  heap,
}: {
  name: string;
  jobCount: number;
  wallMs: number;
  processCpuUs: number;
  cpu: { byCategory: Record<Category, number>; frames: FrameTotal[] };
  heap: { byCategory: Record<Category, number>; frames: FrameTotal[] };
}): string[] => {
  const perJob = (amount: number) => amount / jobCount;
  const microseconds = (amount: number) => `${perJob(amount).toFixed(1)} µs`;
  const kilobytes = (amount: number) => `${(perJob(amount) / 1024).toFixed(2)} KB`;
  const busyCpu = sum(busyCategories.map((category) => cpu.byCategory[category]));
  const allocated = sum(categories.map((category) => heap.byCategory[category]));
  return [
    `-- ${name}, ${jobCount} jobs, ${(wallMs / 1000).toFixed(2)}s wall`,
    "",
    "CPU per job (sampled)",
    ...busyCategories.map(
      (category) =>
        `  ${category.padEnd(14)}${microseconds(cpu.byCategory[category]).padStart(12)}`,
    ),
    `  ${"total".padEnd(14)}${microseconds(busyCpu).padStart(12)}`,
    `  ${"idle".padEnd(14)}${microseconds(cpu.byCategory.idle).padStart(12)}`,
    `  ${"process".padEnd(14)}${microseconds(processCpuUs).padStart(12)}  (process.cpuUsage, user + system)`,
    "",
    "Allocated per job (sampled)",
    ...categories.map(
      (category) => `  ${category.padEnd(14)}${kilobytes(heap.byCategory[category]).padStart(12)}`,
    ),
    `  ${"total".padEnd(14)}${kilobytes(allocated).padStart(12)}`,
    "",
    "Top functions by self CPU time (whole run)",
    ...formatFrames(cpu.frames, (amount) => `${(amount / 1000).toFixed(1)} ms`),
    "",
    "Top functions by self allocation (whole run)",
    ...formatFrames(heap.frames, (amount) => `${(amount / 1024).toFixed(0)} KB`),
  ];
};

const passthrough = async <T>(_label: string, fn: () => Promise<T>): Promise<T> => fn();

export const runProfile = async <TInfra>({
  name,
  setupInfrastructure,
  runLifecycle,
}: DoubleRunBenchmarkOptions<TInfra>): Promise<void> => {
  const { infra, teardown } = await setupInfrastructure();
  const session = new Session();
  const captured = Promise.withResolvers<{
    wallMs: number;
    processCpuUs: number;
    cpuProfile: Profiler.Profile;
    heapProfile: HeapProfiler.SamplingHeapProfile;
  }>();
  try {
    console.log(`\n── WARMUP run (discarded, ${PROFILE_JOB_COUNT} jobs) ──`);
    await runLifecycle(infra, {
      jobCount: PROFILE_JOB_COUNT,
      step: passthrough,
      processStep: passthrough,
    });

    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: CPU_SAMPLING_INTERVAL_US });
    await session.post("HeapProfiler.enable");

    const profiledContext: LifecycleContext = {
      jobCount: PROFILE_JOB_COUNT,
      step: passthrough,
      processStep: async (label, fn) => {
        global.gc?.();
        await session.post("HeapProfiler.startSampling", {
          samplingInterval: HEAP_SAMPLING_INTERVAL_BYTES,
          includeObjectsCollectedByMajorGC: true,
          includeObjectsCollectedByMinorGC: true,
        } as HeapProfiler.StartSamplingParameterType);
        await session.post("Profiler.start");
        const cpuBefore = process.cpuUsage();
        const begin = performance.now();
        const result = await fn();
        const wallMs = performance.now() - begin;
        const cpuUsage = process.cpuUsage(cpuBefore);
        const { profile: cpuProfile } = await session.post("Profiler.stop");
        const { profile: heapProfile } = await session.post("HeapProfiler.stopSampling");
        console.log(`\n${label} (profiled)`);
        captured.resolve({
          wallMs,
          processCpuUs: cpuUsage.user + cpuUsage.system,
          cpuProfile: resolveCpuProfile(cpuProfile),
          heapProfile: { ...heapProfile, head: resolveHeapNode(heapProfile.head) },
        });
        return result;
      },
    };
    console.log(`\n── PROFILED run (${PROFILE_JOB_COUNT} jobs) ──`);
    await runLifecycle(infra, profiledContext);
    captured.reject(new Error(`${name}: the profiled run never reached its work step`));
  } finally {
    session.disconnect();
    await teardown();
  }

  const { wallMs, processCpuUs, cpuProfile, heapProfile } = await captured.promise;
  mkdirSync(profilesDirectory, { recursive: true });
  writeFileSync(`${profilesDirectory}${name}.cpuprofile`, JSON.stringify(cpuProfile));
  writeFileSync(`${profilesDirectory}${name}.heapprofile`, JSON.stringify(heapProfile));

  const report = formatProfileReport({
    name,
    jobCount: PROFILE_JOB_COUNT,
    wallMs,
    processCpuUs,
    cpu: summarizeCpuProfile(cpuProfile),
    heap: summarizeHeapProfile(heapProfile),
  });
  console.log(`\n${report.join("\n")}`);
  mkdirSync(resultsDirectory, { recursive: true });
  writeFileSync(`${resultsDirectory}${name}.txt`, `${report.join("\n")}\n`);
  console.log(`\n  → ${profilesDirectory}${name}.cpuprofile`);
  console.log(`  → ${profilesDirectory}${name}.heapprofile`);
  console.log(`  → ${resultsDirectory}${name}.txt`);
};
