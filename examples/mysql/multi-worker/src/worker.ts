import { createMysqlStateAdapter } from "@queuert/mysql";
import { createMysql2PoolStateProvider } from "example-mysql-state-mysql2/provider";
import type { RowDataPacket } from "mysql2";
import { createPool, type PoolOptions } from "mysql2/promise";
import { createClient, createProcessors, createWorkerRunner, defineJobTypes } from "queuert";

const jobTypes = defineJobTypes<{
  process_order: {
    entry: true;
    input: { orderId: string };
    output: { processedAt: string; processName: string };
  };
}>();

const connectionOptions = JSON.parse(process.env.MYSQL_CONNECTION_OPTIONS!) as PoolOptions;
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS);
const processName = process.env.PROCESS_NAME!;

const resources = new AsyncDisposableStack();
const db = resources.adopt(createPool({ ...connectionOptions, connectionLimit: 5 }), async (pool) =>
  pool.end(),
);

const stateProvider = createMysql2PoolStateProvider({ pool: db });
const stateAdapter = resources.use(createMysqlStateAdapter({ stateProvider, dialect: "mysql" }));

const client = createClient({ stateAdapter, jobTypes });

const workerRunner = createWorkerRunner({
  client,
  concurrency: 2,
  pollIntervalMs,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      process_order: {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          const [rows] = await db.query<({ items: string[]; total: number } & RowDataPacket)[]>(
            "SELECT items, total FROM orders WHERE id = ?",
            [job.input.orderId],
          );
          const order = rows[0];
          if (!order) throw new Error(`Order ${job.input.orderId} not found`);

          process.send!({
            type: "processing",
            orderId: job.input.orderId,
            items: order.items.length,
            total: order.total,
          });

          await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));

          await stateProvider.withTransaction(async (txCtx) =>
            applyJobOutcome({
              ...txCtx,
              output: { processedAt: new Date().toISOString(), processName },
            }),
          );
        },
      },
    },
  }),
});

resources.use(workerRunner);
await workerRunner.start();
process.send!({ type: "ready" });

process.on("message", (msg) => {
  if (msg === "stop") {
    void (async () => {
      await resources.disposeAsync();
      process.send!({ type: "stopped" });
      process.exit(0);
    })();
  }
});
