import { createInProcessStateAdapter } from "queuert";

import { runBenchmark } from "./utils.ts";

await runBenchmark({
  title: "PROCESSING CAPACITY — IN-PROCESS",
  stateAdapter: await createInProcessStateAdapter(),
});
