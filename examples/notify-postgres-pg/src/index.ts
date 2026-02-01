import { type PgNotifyProvider, createPgNotifyAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";

// 1. Start PostgreSQL using testcontainers
console.log("Starting PostgreSQL...");
const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();
const connectionString = pgContainer.getConnectionUri();

// 2. Create PostgreSQL connection pool
const pool = new Pool({ connectionString, max: 10 });

// 3. Create the notify provider using pg
// Uses a dedicated connection for LISTEN and the pool for NOTIFY
let listenClient: PoolClient | null = null;
let connectingPromise: Promise<PoolClient> | null = null;
let closed = false;

const handlers = new Map<string, (message: string) => void>();

const releaseListenClient = (): void => {
  if (listenClient) {
    listenClient.removeAllListeners("notification");
    listenClient.release();
    listenClient = null;
  }
};

const ensureListenClient = async (): Promise<PoolClient> => {
  if (closed) {
    throw new Error("Provider is closed");
  }

  if (listenClient) {
    return listenClient;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = pool.connect().then((client) => {
    connectingPromise = null;

    if (closed) {
      client.release();
      throw new Error("Provider is closed");
    }

    listenClient = client;
    listenClient.on("notification", (msg: { channel: string; payload?: string }) => {
      handlers.get(msg.channel)?.(msg.payload ?? "");
    });

    return listenClient;
  });

  return connectingPromise;
};

const closeProvider = (): void => {
  closed = true;
  releaseListenClient();
  handlers.clear();
};

const notifyProvider: PgNotifyProvider = {
  publish: async (channel, message) => {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_notify($1, $2)", [channel, message]);
    } finally {
      client.release();
    }
  },
  subscribe: async (channel, onMessage) => {
    const client = await ensureListenClient();
    handlers.set(channel, onMessage);
    await client.query(`LISTEN "${channel}"`);
    return async () => {
      handlers.delete(channel);
      try {
        await client.query(`UNLISTEN "${channel}"`);
      } finally {
        if (handlers.size === 0) {
          releaseListenClient();
        }
      }
    };
  },
};

// 4. Define job types
const registry = defineJobTypes<{
  generate_report: {
    entry: true;
    input: { reportType: string; dateRange: { from: string; to: string } };
    output: { reportId: string; rowCount: number };
  };
}>();

// 5. Create adapters
const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = await createPgNotifyAdapter({ provider: notifyProvider });

// 6. Create client and worker
const qrtClient = await createClient({
  stateAdapter,
  notifyAdapter,
  registry,
});

const qrtWorker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry,
  processors: {
    generate_report: {
      attemptHandler: async ({ job, complete }) => {
        console.log(`Generating ${job.input.reportType} report...`);
        // Simulate report generation work
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
});

// 7. Start worker and queue a job
const stopWorker = await qrtWorker.start();

console.log("Requesting sales report...");
const jobChain = await qrtClient.withNotify(async () =>
  stateAdapter.runInTransaction(async (ctx) =>
    qrtClient.startJobChain({
      ...ctx,
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
const result = await qrtClient.waitForJobChainCompletion(jobChain, { timeoutMs: 5000 });
console.log(`Report ready! ID: ${result.output.reportId}, Rows: ${result.output.rowCount}`);

// 10. Cleanup
await stopWorker();
closeProvider();
await pool.end();
await pgContainer.stop();
console.log("Done!");
