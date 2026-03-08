import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const benchmarkDir = resolve(import.meta.dirname, "..");
const projectRoot = resolve(benchmarkDir, "../..");
const generatedDir = join(benchmarkDir, "generated");

type Scenario = {
  name: string;
  description: string;
  group: string;
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

const typeToValue = (typeStr: string): string =>
  typeStr
    .replace(/:\s*string/g, ': ""')
    .replace(/:\s*number/g, ": 0")
    .replace(/:\s*boolean/g, ": false")
    .replace(/:\s*null/g, ": null")
    .replace(/;\s*}/g, " }")
    .replace(/;/g, ",");

const defToTypeString = (def: JobTypeDef): string => {
  const lines = [];
  if (def.entry) lines.push("entry: true;");
  lines.push(`input: ${def.input};`);
  if (def.output) lines.push(`output: ${def.output};`);
  if (def.continueWith) lines.push(`continueWith: ${def.continueWith};`);
  if (def.blockers) lines.push(`blockers: [${def.blockers.join(", ")}];`);
  return `  "${def.name}": {\n    ${lines.join("\n    ")}\n  };`;
};

const generateProcessors = (defs: JobTypeDef[], clientVar: string): string => {
  const processors = defs.map((def) => {
    if (def.output && !def.continueWith) {
      return `    "${def.name}": {
      attemptHandler: async ({ complete }) =>
        complete(async () => (${typeToValue(def.output)})),
    }`;
    }

    if (def.continueWith) {
      const typeNameMatch = def.continueWith.match(/typeName:\s*"([^"]+)"/);
      const firstTarget = typeNameMatch?.[1] ?? "unknown";
      const targetDef = defs.find((d) => d.name === firstTarget);

      if (targetDef?.blockers && targetDef.blockers.length > 0) {
        const blockerStartCalls = targetDef.blockers.map((blockerStr) => {
          const blockerNameMatch = blockerStr.match(/typeName:\s*"([^"]+)"/);
          const blockerName = blockerNameMatch?.[1] ?? "unknown";
          const blockerDef = defs.find((d) => d.name === blockerName);
          const blockerInput = blockerDef ? typeToValue(blockerDef.input) : `{ id: "" }`;
          return `${clientVar}.startJobChain({ ...txCtx, typeName: "${blockerName}", input: ${blockerInput} })`;
        });
        const blockerAwaits = blockerStartCalls
          .map((call, i) => `            const blocker${i} = await ${call};`)
          .join("\n");
        const blockerArray = blockerStartCalls.map((_, i) => `blocker${i}`).join(", ");

        return `    "${def.name}": {
      attemptHandler: async ({ complete }) =>
        complete(async ({ continueWith, ...txCtx }) => {
${blockerAwaits}
            return continueWith({ typeName: "${firstTarget}", input: ${typeToValue(targetDef.input)}, blockers: [${blockerArray}] });
        }),
    }`;
      }

      return `    "${def.name}": {
      attemptHandler: async ({ complete }) =>
        complete(async ({ continueWith }) =>
          continueWith({ typeName: "${firstTarget}", input: ${typeToValue(targetDef?.input ?? "{ id: string }")} })),
    }`;
    }

    return `    "${def.name}": {
      attemptHandler: async ({ complete }) =>
        complete(async () => {}),
    }`;
  });

  return `{\n${processors.join(",\n")},\n  }`;
};

const generateClientCalls = (defs: JobTypeDef[]): string => {
  const entryDef = defs.find((d) => d.entry);
  if (!entryDef) return "";

  const typeName = entryDef.name;
  const input = typeToValue(entryDef.input);

  return `
const { transactionHooks } = createTransactionHooks();
const chain = await client.startJobChain({ typeName: "${typeName}", input: ${input}, transactionHooks });
const fetchedChain = await client.getJobChain({ typeName: "${typeName}", id: chain.id });
const job = await client.getJob({ typeName: "${typeName}", id: chain.id });
const chains = await client.listJobChains({ filter: { typeName: ["${typeName}"] } });
const jobs = await client.listJobs({ filter: { typeName: ["${typeName}"] } });
void fetchedChain;
void job;
void chains;
void jobs;
`;
};

const generateMiddleware = (defsType: string): string =>
  `const middleware: JobAttemptMiddleware<
  ReturnType<typeof createInProcessStateAdapter>,
  ${defsType}
> = async ({ job }, next) => {
  void job.typeName;
  return next();
};
`;

const wrapInScenario = (defs: JobTypeDef[]): string => {
  const typeStrings = defs.map(defToTypeString);
  const processors = generateProcessors(defs, "client");
  const clientCalls = generateClientCalls(defs);
  const middleware = generateMiddleware("Defs");

  return `import { defineJobTypes, defineJobTypeProcessorRegistry, createInProcessWorker, createClient, createTransactionHooks, type JobAttemptMiddleware } from "queuert";
import { createInProcessStateAdapter, createInProcessNotifyAdapter } from "queuert/internal";

type Defs = {
${typeStrings.join("\n")}
};

const jobTypes = defineJobTypes<Defs>();

const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  registry: jobTypes,
});

${middleware}
const worker = await createInProcessWorker({
  client,
  processDefaults: { attemptMiddlewares: [middleware] },
  processorRegistry: defineJobTypeProcessorRegistry(client, jobTypes, ${processors}),
});

const stop = await worker.start();
${clientCalls}
await stop();
`;
};

const wrapMergeScenario = (slices: { name: string; defs: JobTypeDef[] }[]): string => {
  const sliceTypeDecls = slices.map((slice) => {
    const typeStrings = slice.defs.map(defToTypeString);
    return `
type ${slice.name}Defs = {
${typeStrings.join("\n")}
};

const ${slice.name}Registry = defineJobTypes<${slice.name}Defs>();`;
  });

  const sliceProcessorDecls = slices.map((slice) => {
    const processors = generateProcessors(slice.defs, "client");
    return `const ${slice.name}Processors = defineJobTypeProcessorRegistry(client, ${slice.name}Registry, ${processors});`;
  });

  const registryNames = slices.map((s) => `${s.name}Registry`);
  const processorNames = slices.map((s) => `${s.name}Processors`);
  const allDefs = slices.flatMap((s) => s.defs);
  const clientCalls = generateClientCalls(allDefs);
  const mergedDefsType = slices.map((s) => `${s.name}Defs`).join(" & ");
  const middleware = generateMiddleware(mergedDefsType);

  return `import { defineJobTypes, defineJobTypeProcessorRegistry, createInProcessWorker, createClient, createTransactionHooks, mergeJobTypeRegistries, type JobAttemptMiddleware, mergeJobTypeProcessorRegistries } from "queuert";
import { createInProcessStateAdapter, createInProcessNotifyAdapter } from "queuert/internal";
${sliceTypeDecls.join("\n")}

const registry = mergeJobTypeRegistries(${registryNames.join(", ")});

const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

${sliceProcessorDecls.join("\n")}

const mergedProcessorRegistry = mergeJobTypeProcessorRegistries(${processorNames.join(", ")});

${middleware}
const worker = await createInProcessWorker({
  client,
  processDefaults: { attemptMiddlewares: [middleware] },
  processorRegistry: mergedProcessorRegistry,
});

const stop = await worker.start();
${clientCalls}
await stop();
`;
};

// --- Generators ---

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
    const next = isLast ? `"end"` : `"step-${i + 1}"`;
    defs.push({
      name: `step-${i}`,
      input: `{ id: string; step${i}: number }`,
      output: isLast ? `{ result: string }` : undefined,
      continueWith: `{ typeName: "step-${i}" | ${next} }`,
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

// --- Scenario definitions ---

const linearSizes = [1, 5, 10, 20, 50, 100];
const loopSizes = [5, 10, 20, 50, 100];
const blockerSteps = [3, 8, 15, 25];
const branchedConfigs: [number, number][] = [
  [2, 2], // 7 types
  [3, 3], // 40 types
  [4, 3], // 85 types
  [2, 6], // 127 types
];
const mergeConfigs: [number, number][] = [
  [2, 100],
  [5, 100],
];

const scenarios: Scenario[] = [
  // Single-slice: Linear
  ...linearSizes.map(
    (n): Scenario => ({
      name: `linear-${n}`,
      description: `Linear: ${n} types`,
      group: "linear",
      generate: () => wrapInScenario(generateLinearChain(n)),
    }),
  ),

  // Single-slice: Branched
  ...branchedConfigs.map(
    ([b, d]): Scenario => ({
      name: `branched-${b}x${d}`,
      description: `Branched: ${b}w x ${d}d`,
      group: "branched",
      generate: () => wrapInScenario(generateBranchedChain(b, d)),
    }),
  ),

  // Single-slice: Blockers
  ...blockerSteps.map(
    (s): Scenario => ({
      name: `blockers-${s}`,
      description: `Blockers: ${s} steps`,
      group: "blockers",
      generate: () => wrapInScenario(generateWithBlockers(s)),
    }),
  ),

  // Single-slice: Loops
  ...loopSizes.map(
    (l): Scenario => ({
      name: `loop-${l}`,
      description: `Loop: ${l} steps`,
      group: "loop",
      generate: () => wrapInScenario(generateWithLoop(l)),
    }),
  ),

  // Multi-slice: Merge
  ...mergeConfigs.map(
    ([slices, types]): Scenario => ({
      name: `merge-${slices}x${types}`,
      description: `Merge: ${slices} slices x ${types}`,
      group: "merge",
      generate: () =>
        wrapMergeScenario(
          Array.from({ length: slices }, (_, i) => ({
            name: `s${i}`,
            defs: prefixDefs(generateLinearChain(types), `s${i}`),
          })),
        ),
    }),
  ),
];

// --- Types ---

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
  group: string;
  jobTypeCount: number;
  diagnostics: Diagnostics | null;
};

// --- Helpers ---

const countJobTypes = (code: string): number => {
  const typeBlocks = code.match(/type\s+\w+\s*=\s*\{[\s\S]*?\n\};\n/g);
  if (!typeBlocks) return 0;
  let count = 0;
  for (const block of typeBlocks) {
    const entries = block.match(/^\s+"[^"]+": \{$/gm);
    count += entries?.length ?? 0;
  }
  return count;
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

const fmtNum = (n: number | null, suffix = ""): string => {
  if (n === null) return "-";
  return n.toLocaleString() + suffix;
};

const getVersion = (bin: string): string | null => {
  try {
    return execSync(`${bin} --version`, { encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return null;
  }
};

// --- Scenario file generation ---

const generateScenarioFiles = (): Map<
  string,
  { dir: string; code: string; jobTypeCount: number }
> => {
  const scenarioMap = new Map<string, { dir: string; code: string; jobTypeCount: number }>();
  const scenarioNames = new Set(scenarios.map((s) => s.name));

  // Clean up stale generated directories
  try {
    for (const entry of readdirSync(generatedDir)) {
      if (!scenarioNames.has(entry)) {
        rmSync(join(generatedDir, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // generatedDir may not exist yet
  }

  for (const scenario of scenarios) {
    const dir = join(generatedDir, scenario.name);
    mkdirSync(dir, { recursive: true });

    const code = scenario.generate();
    const jobTypeCount = countJobTypes(code);

    writeFileSync(join(dir, "index.ts"), code);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify(
        {
          extends: "@queuert/tsconfig/base",
          compilerOptions: {
            composite: false,
            paths: {
              queuert: ["../../../../packages/core/dist/index.d.mts"],
              "queuert/internal": ["../../../../packages/core/dist/internal.d.mts"],
            },
          },
          include: ["index.ts"],
          exclude: ["node_modules"],
        },
        null,
        2,
      ),
    );

    scenarioMap.set(scenario.name, { dir, code, jobTypeCount });
  }

  return scenarioMap;
};

// --- Runner ---

const tscPath = join(benchmarkDir, "node_modules/.bin/tsc");
const tsgoPath = join(projectRoot, "node_modules/.bin/tsgo");

const args = process.argv.slice(2);
const compilerArg = args.find((a) => !a.startsWith("--"));

const runTypeCheck = (scenarioDir: string, compilerPath: string): Diagnostics | null => {
  try {
    const start = performance.now();
    const stdout = execSync(`${compilerPath} --noEmit --extendedDiagnostics -p tsconfig.json`, {
      cwd: scenarioDir,
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

const iterations = 3;

const runBenchmark = (
  compiler: { name: string; path: string },
  scenarioMap: Map<string, { dir: string; code: string; jobTypeCount: number }>,
): Result[] => {
  const version = getVersion(compiler.path);
  console.log(`\n${"=".repeat(80)}`);
  console.log(`Compiler: ${compiler.name} (${version})`);
  console.log("=".repeat(80));

  // Warmup using the first generated scenario
  const firstScenario = scenarioMap.values().next().value!;
  runTypeCheck(firstScenario.dir, compiler.path);

  const results: Result[] = [];
  let currentGroup = "";

  for (const scenario of scenarios) {
    if (scenario.group !== currentGroup) {
      currentGroup = scenario.group;
      console.log();
      console.log(
        `${"Scenario".padEnd(25)} ${"Types".padStart(5)} ${"Time".padStart(8)} ${"Instantiations".padStart(15)} ${"Memory".padStart(8)}`,
      );
      console.log("-".repeat(65));
    }

    const { dir, jobTypeCount } = scenarioMap.get(scenario.name)!;

    let best: Diagnostics | null = null;

    for (let i = 0; i < iterations; i++) {
      const result = runTypeCheck(dir, compiler.path);
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
      group: scenario.group,
      jobTypeCount,
      diagnostics: best,
    });
  }

  console.log();
  console.log("Scaling (instantiations relative to linear-1 baseline):");
  console.log("-".repeat(60));
  const baseline = results.find((r) => r.name === "linear-1")?.diagnostics?.instantiations;
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

// --- Main ---

console.log("Queuert Type Complexity Benchmark");

try {
  execSync("pnpm --filter queuert build", { cwd: projectRoot, stdio: "pipe" });
} catch {
  console.error("Failed to build queuert. Run `pnpm --filter queuert build` manually.");
  process.exit(1);
}

console.log("Generating scenarios...");
const scenarioMap = generateScenarioFiles();
console.log(`Generated ${scenarioMap.size} scenarios in generated/`);

const allResults: Map<string, Result[]> = new Map();
for (const compiler of compilers) {
  allResults.set(compiler.name, runBenchmark(compiler, scenarioMap));
}

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
