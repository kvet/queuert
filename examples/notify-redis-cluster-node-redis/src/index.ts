import { createRedisNotifyAdapter } from "@queuert/redis";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";
import { createCluster, type RedisClusterType } from "redis";
import { GenericContainer, Wait } from "testcontainers";

import { createNodeRedisClusterNotifyProvider } from "./provider.js";

// grokzen/redis-cluster exposes 6 Redis nodes on 7000..7005.
// IP=0.0.0.0 + nodeAddressMap lets node-redis talk to the cluster through
// the mapped host ports regardless of docker networking.
const INITIAL_PORT = 7000;
const NODE_PORTS = [0, 1, 2, 3, 4, 5].map((i) => INITIAL_PORT + i);

// 1. Start a Redis Cluster using testcontainers
console.log("Starting Redis Cluster...");
const clusterContainer = await new GenericContainer("grokzen/redis-cluster:7.0.10")
  .withExposedPorts(...NODE_PORTS)
  .withEnvironment({
    IP: "0.0.0.0",
    INITIAL_PORT: String(INITIAL_PORT),
    MASTERS: "3",
    SLAVES_PER_MASTER: "1",
  })
  .withWaitStrategy(Wait.forLogMessage(/Cluster state changed: ok/i, 6))
  .withStartupTimeout(120_000)
  .start();

const host = clusterContainer.getHost();
const portMap = new Map<number, number>();
for (const internalPort of NODE_PORTS) {
  portMap.set(internalPort, clusterContainer.getMappedPort(internalPort));
}
const nodeAddressMap = (address: string): { host: string; port: number } | undefined => {
  const portStr = address.split(":").pop();
  if (!portStr) return undefined;
  const mappedPort = portMap.get(Number(portStr));
  if (mappedPort === undefined) return undefined;
  return { host, port: mappedPort };
};
const rootNodes = NODE_PORTS.map((internalPort) => ({
  url: `redis://${host}:${clusterContainer.getMappedPort(internalPort)}`,
}));

// 2. Create Redis Cluster connections
const cluster = createCluster({ rootNodes, nodeAddressMap }) as RedisClusterType;
cluster.on("error", (err) => {
  console.error("Redis Cluster Error", err);
});
await cluster.connect();

const subscribeCluster = createCluster({ rootNodes, nodeAddressMap }) as RedisClusterType;
subscribeCluster.on("error", (err) => {
  console.error("Redis Cluster Subscription Error", err);
});
await subscribeCluster.connect();

// 3. Create the notify provider using node-redis cluster
const notifyProvider = createNodeRedisClusterNotifyProvider({
  cluster,
  subscribeCluster,
});

// 4. Define job types
const jobTypeRegistry = defineJobTypeRegistry<{
  generate_report: {
    entry: true;
    input: { reportType: string; dateRange: { from: string; to: string } };
    output: { reportId: string; rowCount: number };
  };
}>();

// 5. Create adapters
const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = await createRedisNotifyAdapter({ provider: notifyProvider });

// 6. Create client and worker
const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypeRegistry,
});

const qrtWorker = await createInProcessWorker({
  client: qrtClient,
  jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
    client: qrtClient,
    jobTypeRegistry,
    processors: {
      generate_report: {
        attemptHandler: async ({ job, complete }) => {
          console.log(`Generating ${job.input.reportType} report...`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          const rowCount = Math.floor(Math.random() * 1000) + 100;
          console.log(`Report generated with ${rowCount} rows`);
          return complete(async () => ({
            reportId: `RPT-${Date.now()}`,
            rowCount,
          }));
        },
      },
    },
  }),
});

// 7. Start worker and queue a job
const stopWorker = await qrtWorker.start();

console.log("Requesting sales report...");
const jobChain = await withTransactionHooks(async (transactionHooks) =>
  stateAdapter.withTransaction(async (ctx) =>
    qrtClient.startJobChain({
      ...ctx,
      transactionHooks,
      typeName: "generate_report",
      input: { reportType: "sales", dateRange: { from: "2024-01-01", to: "2024-12-31" } },
    }),
  ),
);

// 8. Main thread continues with other work while job processes
console.log("Report queued! Continuing with other work...");
console.log("Preparing email template...");
await new Promise((resolve) => setTimeout(resolve, 100));
console.log("Loading recipient list...");
await new Promise((resolve) => setTimeout(resolve, 100));

// 9. Now wait for the report to be ready
console.log("Waiting for report...");
const result = await qrtClient.awaitJobChain(jobChain, { timeoutMs: 5000 });
console.log(`Report ready! ID: ${result.output.reportId}, Rows: ${result.output.rowCount}`);

// 10. Cleanup
await stopWorker();
await cluster.close();
await subscribeCluster.close();
await clusterContainer.stop();
console.log("Done!");
