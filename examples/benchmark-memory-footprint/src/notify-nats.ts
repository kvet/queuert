/**
 * NATS Notify Adapter Memory Measurement
 */

import { NatsContainer } from "@testcontainers/nats";
import { connect } from "nats";
import { createNatsNotifyAdapter } from "@queuert/nats";
import { createInProcessStateAdapter } from "queuert/internal";
import { createQueuertClient, createQueuertInProcessWorker } from "queuert";
import {
  diffMemory,
  jobTypeRegistry,
  measureBaseline,
  measureMemory,
  printHeader,
  printSummary,
} from "./utils.js";

printHeader("NATS NOTIFY ADAPTER");

const baseline = await measureBaseline();

console.log("\nStarting NATS container...");
const [beforeContainer, afterContainer, natsContainer] = await measureMemory(async () =>
  new NatsContainer("nats:2.10").withExposedPorts(4222).start(),
);
console.log("\nAfter starting container (testcontainers overhead):");
diffMemory(beforeContainer, afterContainer);

const [beforeConnection, afterConnection, nc] = await measureMemory(async () =>
  connect(natsContainer.getConnectionOptions()),
);
console.log("\nAfter creating NATS connection:");
diffMemory(beforeConnection, afterConnection);

const stateAdapter = createInProcessStateAdapter();
const [beforeAdapter, afterAdapter, notifyAdapter] = await measureMemory(async () =>
  createNatsNotifyAdapter({ nc, subjectPrefix: "queuert_perf" }),
);
console.log("\nAfter creating NatsNotifyAdapter:");
diffMemory(beforeAdapter, afterAdapter);

const [beforeSetup, afterSetup, { qrtClient, stopWorker }] = await measureMemory(async () => {
  const qrtClient = await createQueuertClient({
    stateAdapter,
    notifyAdapter,
    log: () => {},
    jobTypeRegistry,
  });

  const qrtWorker = await createQueuertInProcessWorker({
    stateAdapter,
    notifyAdapter,
    log: () => {},
    jobTypeRegistry,
    jobTypeProcessors: {
      "test-job": {
        process: async ({ complete }) => complete(async () => ({ processed: true })),
      },
    },
  });

  const stopWorker = await qrtWorker.start();
  return { qrtClient, stopWorker };
});
console.log("\nAfter creating client + worker:");
diffMemory(beforeSetup, afterSetup);

console.log("\nProcessing 100 jobs...");
const [beforeProcessing, afterProcessing] = await measureMemory(async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const chain = await qrtClient.withNotify(async () =>
      stateAdapter.runInTransaction(async (ctx) =>
        qrtClient.startJobChain({
          ...ctx,
          typeName: "test-job",
          input: { message: `Test message ${i}` },
        }),
      ),
    );
    promises.push(qrtClient.waitForJobChainCompletion(chain, { timeoutMs: 5000 }));
  }
  await Promise.all(promises);
});
console.log("\nAfter processing 100 jobs:");
diffMemory(beforeProcessing, afterProcessing);

await stopWorker();
await nc.close();
await natsContainer.stop();

const [, afterCleanup] = await measureMemory(async () => {});
console.log("\nAfter cleanup (delta from baseline):");
diffMemory(baseline, afterCleanup);

printSummary([
  ["Container + driver:", afterConnection.heapUsed - baseline.heapUsed],
  ["Notify adapter:", afterAdapter.heapUsed - beforeAdapter.heapUsed],
  ["Client + worker:", afterSetup.heapUsed - beforeSetup.heapUsed],
]);
