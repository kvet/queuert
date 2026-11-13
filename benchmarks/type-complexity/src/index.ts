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

const handlerCtxKeys = (count: number): string =>
  count <= 0 ? "" : ", " + Array.from({ length: count }, (_, i) => `ctx${i}`).join(", ");

const voidStmts = (prefix: string, count: number, indent: string): string => {
  if (count <= 0) return "";
  return Array.from({ length: count }, (_, i) => `${indent}void ${prefix}${i};`).join("\n") + "\n";
};

const completeInTransaction = (body: string): string =>
  `stateAdapter.withTransaction(async (txCtx) => {
${body}
          })`;

const generateProcessors = (defs: JobTypeDef[], clientVar: string, middlewareCount = 0): string => {
  const hKeys = handlerCtxKeys(middlewareCount);
  const hVoid = voidStmts("ctx", middlewareCount, "        ");

  const handler = (body: string): string => `      attemptHandler: async ({ complete${hKeys} }) => {
${hVoid}        return ${completeInTransaction(body)};
      },`;

  const processors = defs.map((def) => {
    if (def.output && !def.continueWith) {
      return `    "${def.name}": {
${handler(`            return complete({ ...txCtx, output: (${typeToValue(def.output)}) });`)}
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
          return `${clientVar}.createChain({ ...txCtx, typeName: "${blockerName}", input: ${blockerInput} })`;
        });
        const blockerAwaits = blockerStartCalls
          .map((call, i) => `            const blocker${i} = await ${call};`)
          .join("\n");
        const blockerArray = blockerStartCalls.map((_, i) => `blocker${i}`).join(", ");

        return `    "${def.name}": {
${handler(`${blockerAwaits}
            return complete({ ...txCtx, continueWith: { typeName: "${firstTarget}", input: ${typeToValue(targetDef.input)}, blockers: [${blockerArray}] } });`)}
    }`;
      }

      return `    "${def.name}": {
${handler(`            return complete({ ...txCtx, continueWith: { typeName: "${firstTarget}", input: ${typeToValue(targetDef?.input ?? "{ id: string }")} } });`)}
    }`;
    }

    return `    "${def.name}": {
${handler(`            return complete({ ...txCtx, output: null });`)}
    }`;
  });

  return `{\n${processors.join(",\n")},\n  }`;
};

const generateCompleteChainCall = (defs: JobTypeDef[], entryDef: JobTypeDef): string => {
  const typeName = entryDef.name;

  if (!entryDef.continueWith) {
    return `const completed = await client.completeChain({
  ...txCtx,
  typeName: "${typeName}",
  id: chain.id,
  handler: async ({ job, completeJob }) => {
    if (job.typeName !== "${typeName}") throw new Error("unexpected");
    return completeJob(job, async ({ complete }) => complete({ output: ${typeToValue(entryDef.output ?? "{ result: string }")} }));
  },
});`;
  }

  const typeNameMatch = entryDef.continueWith.match(/typeName:\s*"([^"]+)"/);
  const firstTarget = typeNameMatch?.[1] ?? "unknown";
  const targetDef = defs.find((d) => d.name === firstTarget);
  const targetInput = typeToValue(targetDef?.input ?? "{ id: string }");

  if (targetDef?.blockers && targetDef.blockers.length > 0) {
    const blockerStarts = targetDef.blockers.map((blockerStr, i) => {
      const bMatch = blockerStr.match(/typeName:\s*"([^"]+)"/);
      const bName = bMatch?.[1] ?? "unknown";
      const bDef = defs.find((d) => d.name === bName);
      const bInput = bDef ? typeToValue(bDef.input) : `{ id: "" }`;
      return `const b${i} = await client.createChain({ ...txCtx, typeName: "${bName}", input: ${bInput} });`;
    });
    const blockerArray = targetDef.blockers.map((_, i) => `b${i}`).join(", ");

    return `const completed = await client.completeChain({
  ...txCtx,
  typeName: "${typeName}",
  id: chain.id,
  handler: async ({ job, completeJob }) => {
    if (job.typeName !== "${typeName}") throw new Error("unexpected");
    await completeJob(job, async ({ complete, ...txCtx }) => {
${blockerStarts.map((s) => `      ${s}`).join("\n")}
      return complete({ continueWith: { typeName: "${firstTarget}", input: ${targetInput}, blockers: [${blockerArray}] } });
    });
  },
});`;
  }

  return `const completed = await client.completeChain({
  ...txCtx,
  typeName: "${typeName}",
  id: chain.id,
  handler: async ({ job, completeJob }) => {
    if (job.typeName !== "${typeName}") throw new Error("unexpected");
    await completeJob(job, async ({ complete }) =>
      complete({ continueWith: { typeName: "${firstTarget}", input: ${targetInput} } }));
  },
});`;
};

const generateClientCalls = (defs: JobTypeDef[]): string => {
  const entryDef = defs.find((d) => d.entry);
  if (!entryDef) return "";

  const typeName = entryDef.name;
  const input = typeToValue(entryDef.input);

  return `
await stateAdapter.withTransaction(async (txCtx) => {
    const chain = await client.createChain({ ...txCtx, typeName: "${typeName}", input: ${input} });
    const fetchedChain = await client.getChain({ typeName: "${typeName}", id: chain.id });
    const job = await client.getJob({ typeName: "${typeName}", id: chain.id });
    const chains = await client.listChains({ typeName: "${typeName}" });
    const jobs = await client.listJobs({ typeName: "${typeName}" });
    ${generateCompleteChainCall(defs, entryDef)}
    void fetchedChain;
    void job;
    void chains;
    void jobs;
    void completed;
});
`;
};

const generateMiddleware = (count: number): string => {
  if (count <= 0) return "";
  const decls: string[] = [];
  for (let i = 0; i < count; i++) {
    decls.push(
      `const middleware${i}: AttemptMiddleware<
  ReturnType<typeof createInProcessStateAdapter>,
  { ctx${i}: number }
> = {
  wrapHandler: async ({ job, next }) => {
    void job.typeName;
    return next({ ctx${i}: ${i} });
  },
};`,
    );
  }
  return decls.join("\n") + "\n";
};

const middlewareList = (count: number): string =>
  count <= 0 ? "" : Array.from({ length: count }, (_, i) => `middleware${i}`).join(", ");

const wrapInScenario = (defs: JobTypeDef[], middlewareCount = 1): string => {
  const typeStrings = defs.map(defToTypeString);
  const processors = generateProcessors(defs, "client", middlewareCount);
  const clientCalls = generateClientCalls(defs);
  const middleware = generateMiddleware(middlewareCount);
  const mwList = middlewareList(middlewareCount);
  const mwPart = mwList ? `attemptMiddleware: [${mwList}], ` : "";

  return `import { defineJobTypes, createProcessors, createWorkerRunner, createClient, type AttemptMiddleware } from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";

type Defs = {
${typeStrings.join("\n")}
};

const jobTypes = defineJobTypes<Defs>();

const stateAdapter = createInProcessStateAdapter();

const client = createClient({ stateAdapter, jobTypes });

${middleware}
const workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({ client, jobTypes, ${mwPart}processors: ${processors} }),
});

await workerRunner.start();
${clientCalls}
await workerRunner.stop();
`;
};

const wrapMergeScenario = (
  slices: { name: string; defs: JobTypeDef[] }[],
  middlewareCount = 1,
): string => {
  const sliceTypeDecls = slices.map((slice) => {
    const typeStrings = slice.defs.map(defToTypeString);
    return `
type ${slice.name}Defs = {
${typeStrings.join("\n")}
};

const ${slice.name}Registry = defineJobTypes<${slice.name}Defs>();`;
  });

  const mwList = middlewareList(middlewareCount);
  const mwPart = mwList ? `attemptMiddleware: [${mwList}], ` : "";

  const sliceProcessorDecls = slices.map((slice) => {
    const processors = generateProcessors(slice.defs, "client", middlewareCount);
    return `const ${slice.name}Processors = createProcessors({ client, jobTypes: ${slice.name}Registry, ${mwPart}processors: ${processors} });`;
  });

  const registryNames = slices.map((s) => `${s.name}Registry`);
  const processorNames = slices.map((s) => `${s.name}Processors`);
  const allDefs = slices.flatMap((s) => s.defs);
  const clientCalls = generateClientCalls(allDefs);
  const middleware = generateMiddleware(middlewareCount);

  return `import { defineJobTypes, createProcessors, createWorkerRunner, createClient, type AttemptMiddleware } from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";
${sliceTypeDecls.join("\n")}

const stateAdapter = createInProcessStateAdapter();

const client = createClient({ stateAdapter, jobTypes: [${registryNames.join(", ")}] });

${middleware}
${sliceProcessorDecls.join("\n")}

const workerRunner = createWorkerRunner({
  client,
  processors: [${processorNames.join(", ")}],
});

await workerRunner.start();
${clientCalls}
await workerRunner.stop();
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
const loopSizes = [5, 10, 20, 50];
const blockerSteps = [3, 8, 15, 25];
const branchedConfigs: [number, number][] = [
  [2, 2], // 7 types
  [3, 3], // 40 types
  [4, 3], // 85 types
  [2, 6], // 127 types
];
const mergeConfigs: [number, number][] = [
  [2, 50],
  [5, 50],
  [10, 50],
  [20, 50],
  [50, 50],
];
const middlewareCounts = [1, 2, 5, 10];

const scenarios: Scenario[] = [
  // Single-slice: Linear
  ...linearSizes.map((n): Scenario => ({
    name: `linear-${n}`,
    description: `Linear: ${n} types`,
    group: "linear",
    generate: () => wrapInScenario(generateLinearChain(n)),
  })),

  // Single-slice: Branched
  ...branchedConfigs.map(([b, d]): Scenario => ({
    name: `branched-${b}x${d}`,
    description: `Branched: ${b}w x ${d}d`,
    group: "branched",
    generate: () => wrapInScenario(generateBranchedChain(b, d)),
  })),

  // Single-slice: Blockers
  ...blockerSteps.map((s): Scenario => ({
    name: `blockers-${s}`,
    description: `Blockers: ${s} steps`,
    group: "blockers",
    generate: () => wrapInScenario(generateWithBlockers(s)),
  })),

  // Single-slice: Loops
  ...loopSizes.map((l): Scenario => ({
    name: `loop-${l}`,
    description: `Loop: ${l} steps`,
    group: "loop",
    generate: () => wrapInScenario(generateWithLoop(l)),
  })),

  // Multi-slice: Merge
  ...mergeConfigs.map(([slices, types]): Scenario => ({
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
  })),

  // Middleware scaling: hold chain at linear-100, vary middleware count
  ...middlewareCounts.map((count): Scenario => ({
    name: `middleware-${count}`,
    description: `Middleware: ${count} on linear-100`,
    group: "middleware",
    generate: () => wrapInScenario(generateLinearChain(100), count),
  })),
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

type Compiler = { name: string; label: string; path: string };

// Order matters: the first compiler that runs is the comparison baseline.
const knownCompilers: Compiler[] = [
  { name: "ts6", label: "TS6", path: join(benchmarkDir, "node_modules/typescript-6/bin/tsc") },
  { name: "ts7", label: "TS7", path: join(benchmarkDir, "node_modules/typescript-7/bin/tsc") },
  // Experimental Rust port of the TS 7 checker; tracks a newer TS 7.x than typescript-7.
  { name: "tsrs", label: "tsrs", path: join(benchmarkDir, "node_modules/tsrs/bin/tsrs") },
];

const args = process.argv.slice(2);
const compilerArg = args.find((a) => !a.startsWith("--"));
const filterArg = args.find((a) => a.startsWith("--filter="))?.split("=")[1];

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

let compilers: Compiler[];

if (compilerArg) {
  const requested = knownCompilers.find((c) => c.name === compilerArg);
  if (!requested) {
    console.error(
      `Unknown compiler "${compilerArg}". Expected one of: ${knownCompilers.map((c) => c.name).join(", ")}.`,
    );
    process.exit(1);
  }
  compilers = [requested];
} else {
  compilers = knownCompilers.filter((c) => getVersion(c.path));
}

if (compilers.length === 0) {
  console.error("No TypeScript compiler found. Run `pnpm install` in benchmarks/type-complexity.");
  process.exit(1);
}

const iterations = 3;

const runBenchmark = (
  compiler: Compiler,
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

  const filteredScenarios = filterArg
    ? scenarios.filter((s) => s.name.includes(filterArg) || s.group.includes(filterArg))
    : scenarios;

  for (const scenario of filteredScenarios) {
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

// Comparison table if more than one compiler ran. Speedups are relative to the first compiler.
if (compilers.length > 1) {
  const [baseline, ...others] = compilers;
  const resultsByCompiler = compilers.map((c) => allResults.get(c.name)!);

  const timeOf = (r: Result): number => r.diagnostics?.timeMs ?? -1;
  const timeStr = (r: Result): string =>
    r.diagnostics?.errors ? `ERR(${r.diagnostics.errors})` : timeOf(r) > 0 ? `${timeOf(r)}ms` : "-";

  const columns = [
    ...compilers.map((c) => `${c.label} time`),
    ...others.map((c) => `${c.label} speedup`),
    ...compilers.map((c) => `${c.label} inst`),
  ];
  const width = 25 + columns.length * 13;

  console.log();
  console.log("=".repeat(width));
  console.log(
    `Comparison: ${compilers.map((c) => c.label).join(" vs ")} (speedup vs ${baseline.label})`,
  );
  console.log("=".repeat(width));
  console.log();
  console.log(`${"Scenario".padEnd(25)} ${columns.map((c) => c.padStart(12)).join(" ")}`);
  console.log("-".repeat(width));

  for (let i = 0; i < resultsByCompiler[0].length; i++) {
    const row = resultsByCompiler.map((results) => results[i]);
    const baseTime = timeOf(row[0]);
    const cells = [
      ...row.map(timeStr),
      ...row.slice(1).map((r) => {
        const t = timeOf(r);
        return baseTime > 0 && t > 0 ? `${(baseTime / t).toFixed(1)}x` : "-";
      }),
      ...row.map((r) => fmtNum(r.diagnostics?.instantiations ?? null)),
    ];
    console.log(`${row[0].description.padEnd(25)} ${cells.map((c) => c.padStart(12)).join(" ")}`);
  }
}
