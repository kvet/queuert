import { createNatsNotifyAdapter } from "@queuert/nats";
import { NatsContainer } from "@testcontainers/nats";
import { connect } from "nats";
import { createInProcessStateAdapter } from "queuert";

import { parseConcurrency, printHeader, runBenchmark } from "./utils.js";

printHeader("PROCESSING CAPACITY — NATS NOTIFY");

const concurrency = parseConcurrency();

const stateAdapter = await createInProcessStateAdapter();

console.log("\nStarting NATS container...");
const natsContainer = await new NatsContainer("nats:2.10").withExposedPorts(4222).start();

const nc = await connect(natsContainer.getConnectionOptions());
const notifyAdapter = await createNatsNotifyAdapter({ nc, subjectPrefix: "queuert_bench" });
console.log("NATS ready.");

await runBenchmark({
  stateAdapter,
  notifyAdapter,
  withTransaction: stateAdapter.withTransaction,
  concurrency,
});

await nc.close();
await natsContainer.stop();
