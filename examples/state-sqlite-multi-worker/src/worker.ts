import { createIpcNotifyAdapter } from "@queuert/ipc";
import { createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import {
  createClient,
  createProcessors,
  createWorkerRunner,
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

const processName = process.env.PROCESS_NAME!;

const db = new Database(process.env.DATABASE_PATH);
db.pragma("busy_timeout = 5000");

const stateAdapter = createSqliteStateAdapter({
  stateProvider: createBetterSqlite3StateProvider({ db }),
});
const notifyAdapter = createIpcNotifyAdapter({ directory: process.env.IPC_DIRECTORY! });

const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

const selectOrder = db.prepare("SELECT items, total FROM orders WHERE id = ?");

const workerRunner = createWorkerRunner({
  client,
  concurrency: 2,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      process_order: {
        attemptHandler: async ({ job, complete }) => {
          const order = selectOrder.get(job.input.orderId) as
            | { items: string; total: number }
            | undefined;
          if (!order) throw new Error(`Order ${job.input.orderId} not found`);

          process.send!({
            type: "processing",
            orderId: job.input.orderId,
            items: (JSON.parse(order.items) as string[]).length,
            total: order.total,
          });

          await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));

          return withTxHooks((txHooks) =>
            db.transaction(() =>
              complete({
                db,
                txHooks,
                output: { processedAt: new Date().toISOString(), processName },
              }),
            )(),
          );
        },
      },
    },
  }),
});

await workerRunner.start();
process.send!({ type: "ready" });

process.on("message", (msg) => {
  if (msg === "stop") {
    void (async () => {
      await workerRunner.close();
      notifyAdapter.close();
      stateAdapter.close();
      db.close();
      process.send!({ type: "stopped" });
      process.exit(0);
    })();
  }
});
