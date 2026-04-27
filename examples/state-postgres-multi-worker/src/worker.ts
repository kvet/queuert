import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { createPgPoolNotifyProvider } from "example-notify-postgres-pg/provider";
import { createPgPoolStateProvider } from "example-state-postgres-pg/provider";
import { Pool } from "pg";
import { createClient, createInProcessWorker, createProcessors, defineJobTypes } from "queuert";

const jobTypes = defineJobTypes<{
  process_order: {
    entry: true;
    input: { orderId: string; items: string[]; total: number };
    output: { processedAt: string; workerId: string };
  };
}>();

const connectionString = process.env.CONNECTION_STRING!;
const workerId = process.env.WORKER_ID!;

const pool = new Pool({ connectionString, max: 5 });

const stateProvider = createPgPoolStateProvider({ pool });
const stateAdapter = await createPgStateAdapter({ stateProvider });

const notifyProvider = createPgPoolNotifyProvider({ pool });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

const client = await createClient({ stateAdapter, notifyAdapter, jobTypes });

const worker = await createInProcessWorker({
  client,
  workerId,
  concurrency: 2,
  processors: createProcessors({
    client,
    jobTypes,
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
