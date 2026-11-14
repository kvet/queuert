import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert";

import { runBenchmark } from "./utils.ts";

await runBenchmark({
  title: "PROCESSING CAPACITY — IN-PROCESS NOTIFY (async)",
  stateAdapter: createInProcessStateAdapter({ mode: "async" }),
  notifyAdapter: createInProcessNotifyAdapter({ mode: "async" }),
});
