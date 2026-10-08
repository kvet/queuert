/**
 * Long-Running Jobs Showcase
 *
 * Demonstrates a job whose work takes longer than its attempt timeout.
 *
 * - The work runs outside any transaction, so no database connection is held while it runs
 * - The worker's heartbeat keeps extending the attempt's lease until the handler returns
 * - The handler passes `signal` to its work so it stops if the attempt is lost
 * - When the work is done, the handler opens its own transaction, writes its result and calls finish
 */

import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

import { createPgNotifyAdapter, createPgStateAdapter } from "@queuert/postgres";
import { acquirePostgres } from "@queuert/testcontainers";
import { createPostgresJsNotifyProvider } from "example-notify-postgres-postgres-js/provider";
import { createPostgresJsStateProvider } from "example-state-postgres-postgres-js/provider";
import postgres from "postgres";
import {
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";

const jobTypes = defineJobTypes<{
  "generate-report": {
    entry: true;
    input: { reportId: number; sections: number };
    output: { generatedAt: string };
  };
}>();

const renderSection = async (section: number, signal: AbortSignal): Promise<string> => {
  await sleep(400, undefined, { signal });
  return `Section ${section}: ${Math.round(Math.random() * 1000)} rows`;
};

await using pg = await acquirePostgres("postgres:18", import.meta.url);
const sql = postgres(pg.connectionString, { max: 10 });

const stateProvider = createPostgresJsStateProvider({ sql });
const stateAdapter = await createPgStateAdapter({ stateProvider });
await stateAdapter.migrateToLatest();
const notifyProvider = createPostgresJsNotifyProvider({ sql });
const notifyAdapter = await createPgNotifyAdapter({ notifyProvider });

await sql`
  CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    body TEXT
  )
`;

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  jobTypes,
  log: ({ type }) => {
    if (type === "job_attempt_extended") console.log("  [heartbeat] attempt lease extended");
  },
});

const timeoutMs = 1000;

const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "generate-report": {
        attemptConfig: { timeoutMs, heartbeatMs: 300 },
        attemptHandler: async ({ job, signal, finish }) => {
          console.log(`[generate-report] Rendering ${job.input.sections} sections...`);

          const sections: string[] = [];
          for (let section = 1; section <= job.input.sections; section++) {
            sections.push(await renderSection(section, signal));
            console.log(`  ${sections.at(-1)}`);
          }

          return withTransactionHooks(async (transactionHooks) =>
            sql.begin(async (txSql) => {
              await txSql`UPDATE reports SET status = 'ready', body = ${sections.join("\n")} WHERE id = ${job.input.reportId}`;
              return finish({
                txSql,
                transactionHooks,
                output: { generatedAt: new Date().toISOString() },
              });
            }),
          );
        },
      },
    },
  }),
});

const stopWorker = await worker.start();

console.log(`\n--- Long-running job (attempt timeout ${timeoutMs}ms) ---\n`);

const startedAt = Date.now();
const chain = await withTransactionHooks(async (transactionHooks) =>
  sql.begin(async (txSql) => {
    const [report] = await txSql<{ id: number }[]>`INSERT INTO reports DEFAULT VALUES RETURNING id`;
    return client.createChain({
      txSql,
      transactionHooks,
      typeName: "generate-report",
      input: { reportId: report.id, sections: 6 },
    });
  }),
);

const result = await client.awaitChain(chain, { timeoutMs: 10000 });
const elapsedMs = Date.now() - startedAt;

const [report] = await sql<
  { status: string; body: string }[]
>`SELECT status, body FROM reports WHERE id = ${chain.input.reportId}`;
const job = await client.getJob({ id: chain.id });

console.log(
  `\nReport ${chain.input.reportId} is ${report.status} (generated at ${result.output.generatedAt})`,
);
console.log(
  `Took ${elapsedMs}ms in attempt ${job?.attempt}, longer than the ${timeoutMs}ms timeout`,
);
assert.equal(report.status, "ready");
assert.equal(report.body.split("\n").length, 6);
assert.equal(job?.attempt, 1);
assert.ok(elapsedMs > timeoutMs);

await stopWorker();
await notifyAdapter.close();
await stateAdapter.close();
await sql.end();
