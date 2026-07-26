import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { createPgPoolNotifyProvider } from "example-notify-postgres-pg/provider";
import { createPgPoolStateProvider } from "example-state-postgres-pg/provider";
import { Pool } from "pg";
import { createClient, createInProcessWorker, createProcessors, defineJobTypes } from "queuert";

const jobTypes = defineJobTypes<{
  process_order: {
    entry: true;
    input: { orderId: string };
    output: { processedAt: string; workerName: string };
  };
}>();

const connectionString = process.env.CONNECTION_STRING!;
const workerName = process.env.WORKER_NAME!;

const pool = new Pool({ connectionString, max: 5 });

const stateProvider = createPgPoolStateProvider({ pool });
const stateAdapter = await createPgStateAdapter({ stateProvider });

const notifyProvider = createPgPoolNotifyProvider({ pool });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

const client = await createClient({ stateAdapter, notifyAdapter, jobTypes });

const worker = await createInProcessWorker({
  client,
  workerName,
  concurrency: 2,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      process_order: {
        attemptHandler: async ({ job, prepare, complete }) => {
          // Load the order inside the job transaction
          const order = await prepare({ mode: "staged" }, async ({ poolClient }) => {
            const { rows } = await poolClient.query<{ items: string[]; total: number }>(
              "SELECT items, total FROM orders WHERE id = $1",
              [job.input.orderId],
            );
            const row = rows[0];
            if (!row) throw new Error(`Order ${job.input.orderId} not found`);
            return row;
          });

          process.send!({
            type: "processing",
            orderId: job.input.orderId,
            items: order.items.length,
            total: order.total,
          });

          await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));

          return complete(async () => ({
            processedAt: new Date().toISOString(),
            workerName,
          }));
        },
      },
    },
  }),
});

const stop = await worker.start();
process.send!({ type: "ready" });

process.on("message", (msg) => {
  if (msg === "stop") {
    void (async () => {
      await stop();
      await notifyAdapter.close();
      await stateAdapter.close();
      await pool.end();
      process.send!({ type: "stopped" });
      process.exit(0);
    })();
  }
});
