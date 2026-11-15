import { mkdirSync, writeFileSync } from "node:fs";

import {
  createSeedStateAdapter,
  generateStateDump,
  observabilityCoverageGroups,
  operationalCoverageGroups,
} from "queuert/conformance-internal";

import { writeQueryResults } from "./results.ts";

const ITERATIONS = 10;
const RESULTS_DIR = new URL("../results", import.meta.url).pathname;
const RESULTS_FILE = `${RESULTS_DIR}/in-process.txt`;

const parseScale = (): number => {
  const flag = process.argv.find((argument) => argument.startsWith("--scale="));
  return flag ? parseInt(flag.split("=")[1], 10) : 100;
};

const scale = parseScale();

const stats = (times: number[]) => ({
  p50: times[Math.floor(times.length * 0.5)],
  max: times[times.length - 1],
});

const formatMs = (ms: number) => `${ms.toFixed(2)}ms`;

const timings = new Map<string, { p50: number; max: number }>();
const resultLines: string[] = [];
const report = (line = "") => {
  console.log(line);
  resultLines.push(line);
};

const { stateAdapter, loadState } = createSeedStateAdapter();

console.log(`\nSeeding data (scale=${scale})...`);
const seedStart = performance.now();
const { dump, sentinels } = generateStateDump({ scale });
loadState(dump, { offsetMs: Date.now() - dump.capturedAt.getTime() });
console.log(`Seed complete in ${((performance.now() - seedStart) / 1000).toFixed(1)}s.\n`);

report("═══════════════════════════════════════════════════════════════════════════════════");
report("  QUERY PERFORMANCE — IN-PROCESS");
report("═══════════════════════════════════════════════════════════════════════════════════");

for (const group of [...operationalCoverageGroups, ...observabilityCoverageGroups]) {
  report(`  ${group.name}`);
  for (const testCase of group.cases) {
    const times: number[] = [];
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const act = await testCase.run(stateAdapter, sentinels);
      const start = performance.now();
      await act(stateAdapter, sentinels);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const timing = stats(times);
    timings.set(testCase.key, timing);
    report(
      `    ${testCase.key.padEnd(50)} p50=${formatMs(timing.p50).padStart(10)}  max=${formatMs(timing.max).padStart(10)}`,
    );
  }
  report("");
}

mkdirSync(RESULTS_DIR, { recursive: true });
writeFileSync(RESULTS_FILE, [`-- scale=${scale}`, "", ...resultLines].join("\n") + "\n");
console.log(`  Results written to ${RESULTS_FILE}\n`);
writeQueryResults("In-process", scale, timings);

stateAdapter.close();
