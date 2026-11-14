import { createInProcessStateAdapter } from "queuert";
import { noopNotifyAdapter } from "queuert/conformance-internal";

import { runSyncBenchmark } from "./utils.ts";

await runSyncBenchmark({
  title: "PROCESSING CAPACITY — IN-PROCESS",
  stateAdapter: createInProcessStateAdapter(),
  notifyAdapter: noopNotifyAdapter,
});
