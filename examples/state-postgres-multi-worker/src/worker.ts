import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";

const jobTypes = defineJobTypes<{
  process_order: {
    entry: true;
    input: { orderId: string };
    output: { processedAt: string; processName: string };
  };
}>();

const connectionString = process.env.CONNECTION_STRING!;
const processName = process.env.PROCESS_NAME!;

const sql = postgres(connectionString, { max: 5 });

const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });

const notifyProvider = createPostgresJsNotifyProvider({ sql });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

const client = await createClient({ stateAdapter, notifyAdapter, jobTypes });

const worker = await createInProcessWorker({
  client,
  concurrency: 2,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      process_order: {
        attemptHandler: async ({ job, complete }) => {
          const [order] = await sql<{ items: string[]; total: number }[]>`
            SELECT items, total FROM orders WHERE id = ${job.input.orderId}
          `;
          if (!order) throw new Error(`Order ${job.input.orderId} not found`);

          process.send!({
            type: "processing",
            orderId: job.input.orderId,
            items: order.items.length,
            total: order.total,
          });

          await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));

          return withTxHooks(async (txHooks) =>
            sql.begin(async (txSql) =>
              complete({
                txSql,
                txHooks,
                output: {
                  processedAt: new Date().toISOString(),
                  processName,
                },
              }),
            ),
          );
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
      await sql.end();
      process.send!({ type: "stopped" });
      process.exit(0);
    })();
  }
});
