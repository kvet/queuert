import { createInProcessStateAdapter } from "queuert";
import { noopNotifyAdapter } from "queuert/conformance-internal";

import { runBenchmark } from "./utils.ts";

await runBenchmark({
  title: "PROCESSING CAPACITY — IN-PROCESS (async)",
  stateAdapter: createInProcessStateAdapter({ mode: "async" }),
  notifyAdapter: noopNotifyAdapter,
});
