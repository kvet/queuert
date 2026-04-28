import { createInProcessStateAdapter } from "queuert";

import { runBenchmark } from "./utils.js";

await runBenchmark({
  title: "PROCESSING CAPACITY — IN-PROCESS",
  stateAdapter: await createInProcessStateAdapter(),
});
