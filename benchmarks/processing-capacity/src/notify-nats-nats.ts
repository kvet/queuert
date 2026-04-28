import { createNatsNotifyAdapter } from "@queuert/nats";
import { NatsContainer } from "@testcontainers/nats";
import { connect } from "nats";
import { createInProcessStateAdapter } from "queuert";

import { runBenchmark } from "./utils.js";

console.log("\nStarting NATS container...");
const natsContainer = await new NatsContainer("nats:2.10").withExposedPorts(4222).start();

const nc = await connect(natsContainer.getConnectionOptions());
console.log("NATS ready.");

await runBenchmark({
  title: "PROCESSING CAPACITY — NATS NOTIFY (nats)",
  stateAdapter: await createInProcessStateAdapter(),
  notifyAdapter: await createNatsNotifyAdapter({ nc, subjectPrefix: "queuert_bench" }),
});

await nc.close();
await natsContainer.stop();
