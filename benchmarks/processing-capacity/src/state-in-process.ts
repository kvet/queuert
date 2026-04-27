import { createInProcessStateAdapter } from "queuert";

import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — IN-PROCESS");

const concurrency = parseConcurrency();

const stateAdapter = await createInProcessStateAdapter();

await runBenchmark({
  stateAdapter,
  withTransaction: stateAdapter.withTransaction,
  concurrency,
});
