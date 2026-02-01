import {
  type PgNotifyProvider,
  createPgNotifyAdapter,
  createPgStateAdapter,
} from "@queuert/postgres";
import { Pool, type PoolClient } from "pg";
import { createQueuertInProcessWorker, defineJobTypes } from "queuert";

const registry = defineJobTypes<{
  process_order: {
    entry: true;
    input: { orderId: string; items: string[]; total: number };
    output: { processedAt: string; workerId: string };
  };
}>();

const connectionString = process.env.CONNECTION_STRING!;
const workerId = process.env.WORKER_ID!;

const pool = new Pool({ connectionString, max: 5 });

type DbContext = { poolClient: PoolClient };

const stateAdapter = await createPgStateAdapter({
  stateProvider: {
    runInTransaction: async (cb) => {
      const poolClient = await pool.connect();
      try {
        await poolClient.query("BEGIN");
        const result = await cb({ poolClient });
        await poolClient.query("COMMIT");
        return result;
      } catch (error) {
        await poolClient.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        poolClient.release();
      }
    },
    executeSql: async ({ txContext, sql, params }) => {
      if (txContext) {
        const result = await (txContext as DbContext).poolClient.query(sql, params);
        return result.rows;
      }
      const poolClient = await pool.connect();
      try {
        const result = await poolClient.query(sql, params);
        return result.rows;
      } finally {
        poolClient.release();
      }
    },
  },
  schema: "public",
});

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
    if (closed) throw new Error("Provider is closed");

    if (!listenClient && !connectingPromise) {
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
    }

    const client = listenClient ?? (await connectingPromise!);
    handlers.set(channel, onMessage);
    await client.query(`LISTEN "${channel}"`);

    return async () => {
      handlers.delete(channel);
      try {
        await client.query(`UNLISTEN "${channel}"`);
      } finally {
        if (handlers.size === 0) releaseListenClient();
      }
    };
  },
};

const closeNotify = (): void => {
  closed = true;
  releaseListenClient();
  handlers.clear();
};

const notifyAdapter = await createPgNotifyAdapter({ provider: notifyProvider });

const worker = await createQueuertInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry,
  workerId,
  concurrency: 2,
  processors: {
    process_order: {
      attemptHandler: async ({ job, complete }) => {
        process.send!({
          type: "processing",
          orderId: job.input.orderId,
          items: job.input.items.length,
          total: job.input.total,
        });

        await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));

        return complete(async () => ({
          processedAt: new Date().toISOString(),
          workerId,
        }));
      },
    },
  },
});

const stop = await worker.start();
process.send!({ type: "ready" });

process.on("message", (msg) => {
  if (msg === "stop") {
    void (async () => {
      await stop();
      closeNotify();
      await pool.end();
      process.send!({ type: "stopped" });
      process.exit(0);
    })();
  }
});
