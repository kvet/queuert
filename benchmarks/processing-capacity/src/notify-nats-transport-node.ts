import { connect } from "@nats-io/transport-node";
import { createNatsNotifyAdapter } from "@queuert/nats";
import { createInProcessStateAdapter } from "queuert/internal";

import { benchmarkNamespace, requireEnv, runBenchmark } from "./utils.ts";

const nc = await connect(JSON.parse(requireEnv("BENCHMARK_NATS_OPTIONS")));

await runBenchmark({
  title: "PROCESSING CAPACITY — NATS NOTIFY (nats)",
  stateAdapter: createInProcessStateAdapter(),
  notifyAdapter: createNatsNotifyAdapter({ nc, subjectPrefix: benchmarkNamespace() }),
});

await nc.close();
