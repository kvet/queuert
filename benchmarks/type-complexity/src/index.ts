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

const prepareCtxKeys = (count: number): string =>
  count <= 0 ? "" : ", " + Array.from({ length: count }, (_, i) => `prep${i}`).join(", ");

const completeCtxKeys = (count: number): string =>
  count <= 0 ? "" : ", " + Array.from({ length: count }, (_, i) => `done${i}`).join(", ");

const voidStmts = (prefix: string, count: number, indent: string): string => {
  if (count <= 0) return "";
  return Array.from({ length: count }, (_, i) => `${indent}void ${prefix}${i};`).join("\n") + "\n";
};

const generateProcessors = (defs: JobTypeDef[], clientVar: string, middlewareCount = 0): string => {
  const hKeys = handlerCtxKeys(middlewareCount);
  const pKeys = prepareCtxKeys(middlewareCount);
  const cKeys = completeCtxKeys(middlewareCount);
  const hVoid = voidStmts("ctx", middlewareCount, "        ");
  const pVoid = voidStmts("prep", middlewareCount, "          ");
  const cVoid = voidStmts("done", middlewareCount, "          ");
  const hasMw = middlewareCount > 0;

  // When middleware is present, force prepare-callback evaluation so MergedPrepareCtx
  // is expanded. Otherwise skip to avoid changing the no-middleware baseline.
  const prepareCall = hasMw
    ? `        await prepare({ mode: "atomic" }, async ({${pKeys.replace(/^, /, " ")} }) => {\n${pVoid}        });\n`
    : "";

  const processors = defs.map((def) => {
    if (def.output && !def.continueWith) {
      const completeBody = hasMw
        ? `complete(async ({ finish${cKeys} }) => {\n${cVoid}          return finish({ output: (${typeToValue(def.output)}) });\n        })`
        : `complete(async ({ finish }) => finish({ output: (${typeToValue(def.output)}) }))`;
      return `    "${def.name}": {
      attemptHandler: async ({ complete${hasMw ? ", prepare" : ""}${hKeys} }) => {
${hVoid}${prepareCall}        return ${completeBody};
      },
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

        const completeArgs = `{ finish${hasMw ? cKeys : ""}, ...txCtx }`;

        return `    "${def.name}": {
      attemptHandler: async ({ complete${hasMw ? ", prepare" : ""}${hKeys} }) => {
${hVoid}${prepareCall}        return complete(async (${completeArgs}) => {
${cVoid}${blockerAwaits}
              return finish({ continueWith: { typeName: "${firstTarget}", input: ${typeToValue(targetDef.input)}, blockers: [${blockerArray}] } });
          });
      },
    }`;
      }

      const completeArgs = `{ finish${hasMw ? cKeys : ""} }`;

      return `    "${def.name}": {
      attemptHandler: async ({ complete${hasMw ? ", prepare" : ""}${hKeys} }) => {
${hVoid}${prepareCall}        return complete(async (${completeArgs}) => {
${cVoid}          return finish({ continueWith: { typeName: "${firstTarget}", input: ${typeToValue(targetDef?.input ?? "{ id: string }")} } });
        });
      },
    }`;
    }

    const completeBody = `complete(async ({ finish${hasMw ? cKeys : ""} }) => {\n${cVoid}          return finish({ output: null });\n        })`;
    return `    "${def.name}": {
      attemptHandler: async ({ complete${hasMw ? ", prepare" : ""}${hKeys} }) => {
${hVoid}${prepareCall}        return ${completeBody};
      },
    }`;
  });

  return `{\n${processors.join(",\n")},\n  }`;
};

const generateCompleteChainCall = (defs: JobTypeDef[], entryDef: JobTypeDef): string => {
  const typeName = entryDef.name;

  if (!entryDef.continueWith) {
    return `const completed = await client.completeChain({
  typeName: "${typeName}",
  id: chain.id,
  transactionHooks,
  handler: async ({ job, completeJob }) => {
    if (job.typeName !== "${typeName}") throw new Error("unexpected");
    return completeJob(job, async ({ finish }) => finish({ output: ${typeToValue(entryDef.output ?? "{ result: string }")} }));
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
      return `const b${i} = await client.createChain({ ...txCtx, typeName: "${bName}", input: ${bInput}, transactionHooks });`;
    });
    const blockerArray = targetDef.blockers.map((_, i) => `b${i}`).join(", ");

    return `const completed = await client.completeChain({
  typeName: "${typeName}",
  id: chain.id,
  transactionHooks,
  handler: async ({ job, completeJob }) => {
    if (job.typeName !== "${typeName}") throw new Error("unexpected");
    return completeJob(job, async ({ finish, ...txCtx }) => {
${blockerStarts.map((s) => `      ${s}`).join("\n")}
      return finish({ continueWith: { typeName: "${firstTarget}", input: ${targetInput}, blockers: [${blockerArray}] } });
    });
  },
});`;
  }

  return `const completed = await client.completeChain({
  typeName: "${typeName}",
  id: chain.id,
  transactionHooks,
  handler: async ({ job, completeJob }) => {
    if (job.typeName !== "${typeName}") throw new Error("unexpected");
    return completeJob(job, async ({ finish }) =>
      finish({ continueWith: { typeName: "${firstTarget}", input: ${targetInput} } }));
  },
});`;
};

const generateClientCalls = (defs: JobTypeDef[]): string => {
  const entryDef = defs.find((d) => d.entry);
  if (!entryDef) return "";

  const typeName = entryDef.name;
  const input = typeToValue(entryDef.input);

  return `
const { transactionHooks } = createTransactionHooks();
const chain = await client.createChain({ typeName: "${typeName}", input: ${input}, transactionHooks });
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
`;
};

const generateMiddleware = (count: number): string => {
  if (count <= 0) return "";
  const decls: string[] = [];
  for (let i = 0; i < count; i++) {
    decls.push(
      `const middleware${i}: AttemptMiddleware<
  Awaited<ReturnType<typeof createInProcessStateAdapter>>,
  { ctx${i}: number },
  { prep${i}: string },
  { done${i}: boolean }
> = {
  wrapHandler: async ({ job, next }) => {
    void job.typeName;
    return next({ ctx${i}: ${i} });
  },
  wrapPrepare: async ({ next }) => next({ prep${i}: "p${i}" }),
  wrapComplete: async ({ next }) => next({ done${i}: true }),
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

  return `import { defineJobTypes, createProcessors, createInProcessWorker, createClient, createTransactionHooks, type AttemptMiddleware, createInProcessStateAdapter, createInProcessNotifyAdapter } from "queuert";

type Defs = {
${typeStrings.join("\n")}
};

const jobTypes = defineJobTypes<Defs>();

const stateAdapter = await createInProcessStateAdapter();
const notifyAdapter = await createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
});

${middleware}
const worker = await createInProcessWorker({
  client,
  processors: createProcessors({ client, jobTypes, ${mwPart}processors: ${processors} }),
});

const stop = await worker.start();
${clientCalls}
await stop();
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

  return `import { defineJobTypes, createProcessors, createInProcessWorker, createClient, createTransactionHooks, type AttemptMiddleware, createInProcessStateAdapter, createInProcessNotifyAdapter } from "queuert";
${sliceTypeDecls.join("\n")}

const stateAdapter = await createInProcessStateAdapter();
const notifyAdapter = await createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes: [${registryNames.join(", ")}],
});

${middleware}
${sliceProcessorDecls.join("\n")}

const worker = await createInProcessWorker({
  client,
  processors: [${processorNames.join(", ")}],
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

  // Middleware scaling: hold chain at linear-100, vary middleware count
  ...middlewareCounts.map(
    (count): Scenario => ({
      name: `middleware-${count}`,
      description: `Middleware: ${count} on linear-100`,
      group: "middleware",
      generate: () => wrapInScenario(generateLinearChain(100), count),
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

const ts6Path = join(benchmarkDir, "node_modules/typescript-6/bin/tsc");
const ts7Path = join(benchmarkDir, "node_modules/typescript-7/bin/tsc");

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

const compilers: { name: string; path: string }[] = [];

if (compilerArg === "ts6") {
  compilers.push({ name: "ts6", path: ts6Path });
} else if (compilerArg === "ts7") {
  compilers.push({ name: "ts7", path: ts7Path });
} else {
  if (getVersion(ts6Path)) compilers.push({ name: "ts6", path: ts6Path });
  if (getVersion(ts7Path)) compilers.push({ name: "ts7", path: ts7Path });
}

if (compilers.length === 0) {
  console.error("No TypeScript compiler found. Run `bun install` in benchmarks/type-complexity.");
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
  execSync("bun run --filter queuert build", { cwd: projectRoot, stdio: "pipe" });
} catch {
  console.error("Failed to build queuert. Run `bun run --filter queuert build` manually.");
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
  const ts6Results = allResults.get("ts6")!;
  const ts7Results = allResults.get("ts7")!;

  console.log();
  console.log("=".repeat(80));
  console.log("Comparison: TS 6 vs TS 7");
  console.log("=".repeat(80));
  console.log();
  console.log(
    `${"Scenario".padEnd(25)} ${"TS6 time".padStart(10)} ${"TS7 time".padStart(10)} ${"Speedup".padStart(8)} ${"TS6 inst".padStart(12)} ${"TS7 inst".padStart(12)}`,
  );
  console.log("-".repeat(80));

  for (let i = 0; i < ts6Results.length; i++) {
    const ts6 = ts6Results[i];
    const ts7 = ts7Results[i];
    const ts6Time = ts6.diagnostics?.timeMs ?? -1;
    const ts7Time = ts7.diagnostics?.timeMs ?? -1;
    const ts6TimeStr = ts6.diagnostics?.errors
      ? `ERR(${ts6.diagnostics.errors})`
      : ts6Time > 0
        ? `${ts6Time}ms`
        : "-";
    const ts7TimeStr = ts7.diagnostics?.errors
      ? `ERR(${ts7.diagnostics.errors})`
      : ts7Time > 0
        ? `${ts7Time}ms`
        : "-";
    const speedup = ts6Time > 0 && ts7Time > 0 ? `${(ts6Time / ts7Time).toFixed(1)}x` : "-";
    const ts6Inst = fmtNum(ts6.diagnostics?.instantiations ?? null);
    const ts7Inst = fmtNum(ts7.diagnostics?.instantiations ?? null);

    console.log(
      `${ts6.description.padEnd(25)} ${ts6TimeStr.padStart(10)} ${ts7TimeStr.padStart(10)} ${speedup.padStart(8)} ${ts6Inst.padStart(12)} ${ts7Inst.padStart(12)}`,
    );
  }
}
