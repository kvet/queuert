import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const benchmarkDir = resolve(import.meta.dirname, "..");
const projectRoot = resolve(benchmarkDir, "../..");

type Scenario = {
  name: string;
  description: string;
  generate: () => string;
};

type JobTypeDef = {
  name: string;
  entry?: boolean;
  input: string;
  output?: string;
  continueWith?: string;
  blockers?: string[];
};

const defToTypeString = (def: JobTypeDef): string => {
  const lines = [];
  if (def.entry) lines.push("entry: true;");
  lines.push(`input: ${def.input};`);
  if (def.output) lines.push(`output: ${def.output};`);
  if (def.continueWith) lines.push(`continueWith: ${def.continueWith};`);
  if (def.blockers) lines.push(`blockers: [${def.blockers.join(", ")}];`);
  return `  "${def.name}": {\n    ${lines.join("\n    ")}\n  };`;
};

const generateProcessors = (defs: JobTypeDef[]): string => {
  const processors = defs.map((def) => {
    if (def.output && !def.continueWith) {
      return `    "${def.name}": {
      attemptHandler: async ({ complete }) =>
        complete(async () => ({} as any)),
    }`;
    }

    if (def.continueWith) {
      const typeNameMatch = def.continueWith.match(/typeName:\s*"([^"]+)"/);
      const firstTarget = typeNameMatch?.[1] ?? "unknown";
      const targetDef = defs.find((d) => d.name === firstTarget);
      const needsBlockers = targetDef?.blockers && targetDef.blockers.length > 0;

      return `    "${def.name}": {
      attemptHandler: async ({ complete }) =>
        complete(async ({ continueWith }) =>
          continueWith({ typeName: "${firstTarget}", input: {} as any${needsBlockers ? ", blockers: [] as any" : ""} })),
    }`;
    }

    return `    "${def.name}": {
      attemptHandler: async ({ complete }) =>
        complete(async () => {}),
    }`;
  });

  return `{\n${processors.join(",\n")},\n  }`;
};

const wrapInScenario = (defs: JobTypeDef[]): string => {
  const typeStrings = defs.map(defToTypeString);
  const processors = generateProcessors(defs);

  return `import { defineJobTypes, defineJobTypeProcessors, createInProcessWorker, createClient } from "queuert";
import { createInProcessStateAdapter, createInProcessNotifyAdapter } from "queuert/internal";

type Defs = {
${typeStrings.join("\n")}
};

const jobTypes = defineJobTypes<Defs>();
const processors = defineJobTypeProcessors(jobTypes, ${processors});

const stateAdapter = await createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  registry: jobTypes,
});

const _worker = await createInProcessWorker({
  client,
  processors,
});
`;
};

const wrapMergeScenario = (slices: { name: string; defs: JobTypeDef[] }[]): string => {
  const sliceDecls = slices.map((slice) => {
    const typeStrings = slice.defs.map(defToTypeString);
    const processors = generateProcessors(slice.defs);
    return `
type ${slice.name}Defs = {
${typeStrings.join("\n")}
};

const ${slice.name}Registry = defineJobTypes<${slice.name}Defs>();

const ${slice.name}Processors = defineJobTypeProcessors(${slice.name}Registry, ${processors});`;
  });

  const registryNames = slices.map((s) => `${s.name}Registry`);
  const processorNames = slices.map((s) => `${s.name}Processors`);

  return `import { defineJobTypes, defineJobTypeProcessors, createInProcessWorker, createClient, mergeJobTypeRegistries, mergeJobTypeProcessors } from "queuert";
import { createInProcessStateAdapter, createInProcessNotifyAdapter } from "queuert/internal";
${sliceDecls.join("\n")}

const registry = mergeJobTypeRegistries(${registryNames.join(", ")});
const processors = mergeJobTypeProcessors(${processorNames.join(", ")});

const stateAdapter = await createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

const _worker = await createInProcessWorker({
  client,
  processors,
});
`;
};

const generateLinearChain = (depth: number): JobTypeDef[] => {
  const defs: JobTypeDef[] = [];
  for (let i = 0; i < depth; i++) {
    defs.push({
      name: `step-${i}`,
      entry: i === 0,
      input: `{ id: string; value${i}: number }`,
      output: i === depth - 1 ? `{ result: string }` : undefined,
      continueWith: i < depth - 1 ? `{ typeName: "step-${i + 1}" }` : undefined,
    });
  }
  return defs;
};

const generateBranchedChain = (breadth: number, depth: number): JobTypeDef[] => {
  const defs: JobTypeDef[] = [];
  let idx = 0;

  const addLevel = (prefix: string, currentDepth: number, isRoot: boolean): void => {
    if (currentDepth >= depth) {
      defs.push({
        name: prefix,
        input: `{ id: string; val${idx++}: number }`,
        output: `{ done: boolean }`,
      });
      return;
    }

    const children: string[] = [];
    for (let b = 0; b < breadth; b++) {
      children.push(`${prefix}-b${b}`);
    }

    defs.push({
      name: prefix,
      entry: isRoot,
      input: `{ id: string; val${idx++}: number }`,
      continueWith: `{ typeName: ${children.map((n) => `"${n}"`).join(" | ")} }`,
    });

    for (const child of children) {
      addLevel(child, currentDepth + 1, false);
    }
  };

  addLevel("root", 0, true);
  return defs;
};

const generateWithBlockers = (jobCount: number): JobTypeDef[] => {
  const defs: JobTypeDef[] = [];

  defs.push({
    name: "entry-job",
    entry: true,
    input: `{ id: string }`,
    continueWith: `{ typeName: "job-1" }`,
  });

  for (let i = 1; i <= jobCount; i++) {
    const isLast = i === jobCount;
    const blockerCount = Math.min(i, 3);
    const blockers: string[] = [];

    for (let b = 1; b <= blockerCount; b++) {
      blockers.push(`{ typeName: "blocker-${i}-${b}" }`);
      defs.push({
        name: `blocker-${i}-${b}`,
        entry: true,
        input: `{ blockerId: string }`,
        output: `{ blockerResult${i}_${b}: string }`,
      });
    }

    defs.push({
      name: `job-${i}`,
      input: `{ id: string; step${i}: number }`,
      output: isLast ? `{ result: string }` : undefined,
      continueWith: !isLast ? `{ typeName: "job-${i + 1}" }` : undefined,
      blockers,
    });
  }

  return defs;
};

const generateWithLoop = (chainLength: number): JobTypeDef[] => {
  const defs: JobTypeDef[] = [];

  defs.push({
    name: "start",
    entry: true,
    input: `{ id: string }`,
    continueWith: `{ typeName: "step-1" }`,
  });

  for (let i = 1; i < chainLength; i++) {
    const isLast = i === chainLength - 1;
    defs.push({
      name: `step-${i}`,
      input: isLast ? `{ id: string; cycle: number }` : `{ id: string; step${i}: number }`,
      output: isLast ? `{ result: string }` : undefined,
      continueWith: isLast ? `{ typeName: "step-${i}" | "end" }` : `{ typeName: "step-${i + 1}" }`,
    });
  }

  defs.push({
    name: "end",
    input: `{ id: string; reason: string }`,
    output: `{ done: boolean }`,
  });

  return defs;
};

const prefixDefs = (defs: JobTypeDef[], prefix: string): JobTypeDef[] =>
  defs.map((d) => ({
    ...d,
    name: `${prefix}-${d.name}`,
    continueWith: d.continueWith?.replace(/"([^"]+)"/g, `"${prefix}-$1"`),
    blockers: d.blockers?.map((b) => b.replace(/"([^"]+)"/g, `"${prefix}-$1"`)),
  }));

const scenarios: Scenario[] = [
  {
    name: "linear-3",
    description: "Linear: 3 types",
    generate: () => wrapInScenario(generateLinearChain(3)),
  },
  {
    name: "linear-5",
    description: "Linear: 5 types",
    generate: () => wrapInScenario(generateLinearChain(5)),
  },
  {
    name: "linear-10",
    description: "Linear: 10 types",
    generate: () => wrapInScenario(generateLinearChain(10)),
  },
  {
    name: "linear-20",
    description: "Linear: 20 types",
    generate: () => wrapInScenario(generateLinearChain(20)),
  },
  {
    name: "linear-30",
    description: "Linear: 30 types",
    generate: () => wrapInScenario(generateLinearChain(30)),
  },
  {
    name: "branched-2x2",
    description: "Branched: 2w x 2d",
    generate: () => wrapInScenario(generateBranchedChain(2, 2)),
  },
  {
    name: "branched-3x3",
    description: "Branched: 3w x 3d",
    generate: () => wrapInScenario(generateBranchedChain(3, 3)),
  },
  {
    name: "branched-4x3",
    description: "Branched: 4w x 3d",
    generate: () => wrapInScenario(generateBranchedChain(4, 3)),
  },
  {
    name: "blockers-3",
    description: "Blockers: 3 steps",
    generate: () => wrapInScenario(generateWithBlockers(3)),
  },
  {
    name: "blockers-5",
    description: "Blockers: 5 steps",
    generate: () => wrapInScenario(generateWithBlockers(5)),
  },
  {
    name: "blockers-8",
    description: "Blockers: 8 steps",
    generate: () => wrapInScenario(generateWithBlockers(8)),
  },
  {
    name: "loop-3",
    description: "Loop: 3 steps",
    generate: () => wrapInScenario(generateWithLoop(3)),
  },
  {
    name: "loop-5",
    description: "Loop: 5 steps",
    generate: () => wrapInScenario(generateWithLoop(5)),
  },
  {
    name: "loop-10",
    description: "Loop: 10 steps",
    generate: () => wrapInScenario(generateWithLoop(10)),
  },
  {
    name: "loop-20",
    description: "Loop: 20 steps",
    generate: () => wrapInScenario(generateWithLoop(20)),
  },
  {
    name: "merge-2x3",
    description: "Merge: 2 slices x 3",
    generate: () =>
      wrapMergeScenario([
        { name: "sliceA", defs: prefixDefs(generateLinearChain(3), "a") },
        { name: "sliceB", defs: prefixDefs(generateLinearChain(3), "b") },
      ]),
  },
  {
    name: "merge-3x5",
    description: "Merge: 3 slices x 5",
    generate: () =>
      wrapMergeScenario([
        { name: "sliceA", defs: prefixDefs(generateLinearChain(5), "a") },
        { name: "sliceB", defs: prefixDefs(generateLinearChain(5), "b") },
        { name: "sliceC", defs: prefixDefs(generateLinearChain(5), "c") },
      ]),
  },
  {
    name: "merge-4x10",
    description: "Merge: 4 slices x 10",
    generate: () =>
      wrapMergeScenario([
        { name: "sliceA", defs: prefixDefs(generateLinearChain(10), "a") },
        { name: "sliceB", defs: prefixDefs(generateLinearChain(10), "b") },
        { name: "sliceC", defs: prefixDefs(generateLinearChain(10), "c") },
        { name: "sliceD", defs: prefixDefs(generateLinearChain(10), "d") },
      ]),
  },
  {
    name: "many-10x3",
    description: "Many: 10 x 3-step",
    generate: () =>
      wrapMergeScenario(
        Array.from({ length: 10 }, (_, i) => ({
          name: `s${i}`,
          defs: prefixDefs(generateLinearChain(3), `s${i}`),
        })),
      ),
  },
  {
    name: "many-20x3",
    description: "Many: 20 x 3-step",
    generate: () =>
      wrapMergeScenario(
        Array.from({ length: 20 }, (_, i) => ({
          name: `s${i}`,
          defs: prefixDefs(generateLinearChain(3), `s${i}`),
        })),
      ),
  },
  {
    name: "many-5x20",
    description: "Many: 5 x 20-step",
    generate: () =>
      wrapMergeScenario(
        Array.from({ length: 5 }, (_, i) => ({
          name: `s${i}`,
          defs: prefixDefs(generateLinearChain(20), `s${i}`),
        })),
      ),
  },
  {
    name: "many-10x20",
    description: "Many: 10 x 20-step",
    generate: () =>
      wrapMergeScenario(
        Array.from({ length: 10 }, (_, i) => ({
          name: `s${i}`,
          defs: prefixDefs(generateLinearChain(20), `s${i}`),
        })),
      ),
  },
];

type Diagnostics = {
  timeMs: number;
  errors: number;
  types: number | null;
  instantiations: number | null;
  memoryMB: number | null;
};

type Result = {
  name: string;
  description: string;
  jobTypeCount: number;
  diagnostics: Diagnostics | null;
};

const countJobTypes = (code: string): number => {
  const matches = code.match(/^\s+"[^"]+": \{$/gm);
  return matches?.length ?? 0;
};

const parseDiagnostics = (output: string): Partial<Diagnostics> => {
  const result: Partial<Diagnostics> = {};
  const typesMatch = output.match(/Types:\s+([\d,]+)/);
  if (typesMatch) result.types = Number(typesMatch[1].replace(/,/g, ""));
  const instantiationsMatch = output.match(/Instantiations:\s+([\d,]+)/);
  if (instantiationsMatch) result.instantiations = Number(instantiationsMatch[1].replace(/,/g, ""));
  const memoryMatch = output.match(/Memory used:\s+([\d,]+)K/);
  if (memoryMatch) result.memoryMB = Math.round(Number(memoryMatch[1].replace(/,/g, "")) / 1024);
  return result;
};

const tscPath = join(projectRoot, "node_modules/.bin/tsc");
const tsgoPath = join(projectRoot, "node_modules/.bin/tsgo");

const args = process.argv.slice(2);
const compilerArg = args.find((a) => !a.startsWith("--"));

const scenarioFile = join(benchmarkDir, "src", "_scenario.gen.ts");
const scenarioTsconfig = join(benchmarkDir, "tsconfig.scenario.json");

try {
  execSync("pnpm --filter queuert build", { cwd: projectRoot, stdio: "pipe" });
} catch {
  console.error("Failed to build queuert. Run `pnpm --filter queuert build` manually.");
  process.exit(1);
}

writeFileSync(
  scenarioTsconfig,
  JSON.stringify({
    extends: "@queuert/tsconfig/base",
    compilerOptions: {
      composite: false,
      paths: {
        queuert: ["../../packages/core/dist/index.d.mts"],
        "queuert/internal": ["../../packages/core/dist/internal.d.mts"],
      },
    },
    include: ["src/_scenario.gen.ts"],
    exclude: ["node_modules", "dist"],
  }),
);

const runTypeCheck = (code: string, tscPath: string): Diagnostics | null => {
  writeFileSync(scenarioFile, code);
  try {
    const start = performance.now();
    const stdout = execSync(`${tscPath} --noEmit --extendedDiagnostics -p tsconfig.scenario.json`, {
      cwd: benchmarkDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    const timeMs = Math.round(performance.now() - start);
    const diag = parseDiagnostics(stdout);
    return {
      timeMs,
      errors: 0,
      types: diag.types ?? null,
      instantiations: diag.instantiations ?? null,
      memoryMB: diag.memoryMB ?? null,
    };
  } catch (e: unknown) {
    const err = e as { stdout: string; stderr: string };
    const output = (err.stdout ?? "") + (err.stderr ?? "");
    const errorLines = output.split("\n").filter((l) => l.includes("error TS"));
    const errorCount = errorLines.length;

    if (errorCount > 0) {
      console.error(`  Errors: ${errorLines[0]}`);
      const diag = parseDiagnostics(output);
      return {
        timeMs: -1,
        errors: errorCount,
        types: diag.types ?? null,
        instantiations: diag.instantiations ?? null,
        memoryMB: diag.memoryMB ?? null,
      };
    }
    return null;
  }
};

const getVersion = (bin: string): string | null => {
  try {
    return execSync(`${bin} --version`, { encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return null;
  }
};

const compilers: { name: string; path: string }[] = [];

if (compilerArg === "tsc") {
  compilers.push({ name: "tsc", path: tscPath });
} else if (compilerArg === "tsgo") {
  compilers.push({ name: "tsgo", path: tsgoPath });
} else {
  if (getVersion(tscPath)) compilers.push({ name: "tsc", path: tscPath });
  if (getVersion(tsgoPath)) compilers.push({ name: "tsgo", path: tsgoPath });
}

if (compilers.length === 0) {
  console.error("No TypeScript compiler found. Install typescript or @typescript/native-preview.");
  process.exit(1);
}

const fmtNum = (n: number | null, suffix = ""): string => {
  if (n === null) return "-";
  return n.toLocaleString() + suffix;
};

const iterations = 3;

const runBenchmark = (compiler: { name: string; path: string }): Result[] => {
  const version = getVersion(compiler.path);
  console.log(`\n${"=".repeat(80)}`);
  console.log(`Compiler: ${compiler.name} (${version})`);
  console.log("=".repeat(80));
  console.log();

  // Warmup
  runTypeCheck(
    `import { defineJobTypes } from "queuert";\nconst _j = defineJobTypes<{ "a": { entry: true; input: { x: number }; output: { y: string } } }>();\n`,
    compiler.path,
  );

  const results: Result[] = [];

  console.log(
    `${"Scenario".padEnd(25)} ${"Types".padStart(5)} ${"Time".padStart(8)} ${"Instantiations".padStart(15)} ${"Memory".padStart(8)}`,
  );
  console.log("-".repeat(65));

  for (const scenario of scenarios) {
    const code = scenario.generate();
    const jobTypeCount = countJobTypes(code);

    let best: Diagnostics | null = null;

    for (let i = 0; i < iterations; i++) {
      const result = runTypeCheck(code, compiler.path);
      if (
        result &&
        (best === null ||
          (result.errors === 0 && result.timeMs < (best.timeMs === -1 ? Infinity : best.timeMs)))
      ) {
        best = result;
      }
    }

    const timeStr = best ? (best.errors > 0 ? `ERR(${best.errors})` : `${best.timeMs}ms`) : "FAIL";

    console.log(
      `${scenario.description.padEnd(25)} ${String(jobTypeCount).padStart(5)} ${timeStr.padStart(8)} ${fmtNum(best?.instantiations ?? null).padStart(15)} ${fmtNum(best?.memoryMB ?? null, "MB").padStart(8)}`,
    );

    results.push({
      name: scenario.name,
      description: scenario.description,
      jobTypeCount,
      diagnostics: best,
    });
  }

  console.log();
  console.log("Scaling (instantiations relative to linear-3 baseline):");
  console.log("-".repeat(60));
  const baseline = results.find((r) => r.name === "linear-3")?.diagnostics?.instantiations;
  if (baseline) {
    for (const r of results) {
      const inst = r.diagnostics?.instantiations;
      if (inst) {
        const ratio = (inst / baseline).toFixed(1);
        const bar = "#".repeat(Math.min(Math.round(inst / baseline), 60));
        console.log(`${r.description.padEnd(25)} ${ratio.padStart(6)}x  ${bar}`);
      }
    }
  }

  return results;
};

console.log("Queuert Type Complexity Benchmark (prebuilt .d.mts)");

const allResults: Map<string, Result[]> = new Map();
for (const compiler of compilers) {
  allResults.set(compiler.name, runBenchmark(compiler));
}

// Clean up
try {
  rmSync(scenarioFile);
  rmSync(scenarioTsconfig);
} catch {}

// Comparison table if both compilers ran
if (allResults.size > 1) {
  const tscResults = allResults.get("tsc")!;
  const tsgoResults = allResults.get("tsgo")!;

  console.log();
  console.log("=".repeat(80));
  console.log("Comparison: tsc vs tsgo");
  console.log("=".repeat(80));
  console.log();
  console.log(
    `${"Scenario".padEnd(25)} ${"tsc time".padStart(10)} ${"tsgo time".padStart(10)} ${"Speedup".padStart(8)} ${"tsc inst".padStart(12)} ${"tsgo inst".padStart(12)}`,
  );
  console.log("-".repeat(80));

  for (let i = 0; i < tscResults.length; i++) {
    const tsc = tscResults[i];
    const tsgo = tsgoResults[i];
    const tscTime = tsc.diagnostics?.timeMs ?? -1;
    const tsgoTime = tsgo.diagnostics?.timeMs ?? -1;
    const tscTimeStr = tsc.diagnostics?.errors
      ? `ERR(${tsc.diagnostics.errors})`
      : tscTime > 0
        ? `${tscTime}ms`
        : "-";
    const tsgoTimeStr = tsgo.diagnostics?.errors
      ? `ERR(${tsgo.diagnostics.errors})`
      : tsgoTime > 0
        ? `${tsgoTime}ms`
        : "-";
    const speedup = tscTime > 0 && tsgoTime > 0 ? `${(tscTime / tsgoTime).toFixed(1)}x` : "-";
    const tscInst = fmtNum(tsc.diagnostics?.instantiations ?? null);
    const tsgoInst = fmtNum(tsgo.diagnostics?.instantiations ?? null);

    console.log(
      `${tsc.description.padEnd(25)} ${tscTimeStr.padStart(10)} ${tsgoTimeStr.padStart(10)} ${speedup.padStart(8)} ${tscInst.padStart(12)} ${tsgoInst.padStart(12)}`,
    );
  }
}
