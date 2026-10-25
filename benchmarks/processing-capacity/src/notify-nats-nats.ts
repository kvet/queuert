import { createNatsNotifyAdapter } from "@queuert/nats";
import { connect } from "nats";
import { createInProcessStateAdapter } from "queuert";

import { benchmarkNamespace, requireEnv, runBenchmark } from "./utils.js";

const nc = await connect(JSON.parse(requireEnv("BENCHMARK_NATS_OPTIONS")));

await runBenchmark({
  title: "PROCESSING CAPACITY — NATS NOTIFY (nats)",
  stateAdapter: await createInProcessStateAdapter(),
  notifyAdapter: await createNatsNotifyAdapter({ nc, subjectPrefix: benchmarkNamespace() }),
});

await nc.close();
