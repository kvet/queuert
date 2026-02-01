/**
 * Timeouts Showcase
 *
 * Demonstrates timeout patterns for job processing.
 *
 * Scenarios:
 * 1. Cooperative Timeout: Using AbortSignal.timeout() with the job signal
 * 2. Hard Timeout: Using leaseConfig for automatic job reclamation
 */

import { type PgStateProvider, createPgStateAdapter } from "@queuert/postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, {
  type PendingQuery,
  type Row,
  type TransactionSql as _TransactionSql,
} from "postgres";
import { createClient, createInProcessWorker, defineJobTypes } from "queuert";
import { createInProcessNotifyAdapter } from "queuert/internal";

type TransactionSql = _TransactionSql & {
  <T extends readonly (object | undefined)[] = Row[]>(
    template: TemplateStringsArray,
    ...parameters: readonly postgres.ParameterOrFragment<never>[]
  ): PendingQuery<T>;
};

type DbContext = { sql: TransactionSql };

const jobTypes = defineJobTypes<{
  // Job with cooperative timeout
  "fetch-with-timeout": {
    entry: true;
    input: { url: string; timeoutMs: number };
    output: { data: string } | { timedOut: true };
  };

  // Job demonstrating hard timeout via lease
  "long-running-job": {
    entry: true;
    input: { taskId: string; durationMs: number };
    output: { completed: true; attempt: number };
  };
}>();

async function simulatedFetch(url: string, signal: AbortSignal, delayMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeout = setTimeout(() => {
      resolve(`Data from ${url}`);
    }, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

const pgContainer = await new PostgreSqlContainer("postgres:14").withExposedPorts(5432).start();
const sql = postgres(pgContainer.getConnectionUri(), { max: 10 });

const stateProvider: PgStateProvider<DbContext> = {
  runInTransaction: async (cb) => {
    let result: any;
    await sql.begin(async (txSql) => {
      result = await cb({ sql: txSql as TransactionSql });
    });
    return result;
  },
  executeSql: async ({ txContext, sql: query, params }) => {
    const client = txContext?.sql ?? sql;
    return client.unsafe(
      query,
      (params ?? []).map((p) => (p === undefined ? null : p)) as (
        | string
        | number
        | boolean
        | null
      )[],
    );
  },
};

const stateAdapter = await createPgStateAdapter({ stateProvider, schema: "public" });
await stateAdapter.migrateToLatest();
const notifyAdapter = createInProcessNotifyAdapter();

const client = await createClient({
  stateAdapter,
  notifyAdapter,
  registry: jobTypes,
});

const worker = await createInProcessWorker({
  stateAdapter,
  notifyAdapter,
  registry: jobTypes,
  processors: {
    "fetch-with-timeout": {
      attemptHandler: async ({ signal, job, complete }) => {
        console.log(
          `[fetch-with-timeout] Fetching ${job.input.url} (timeout: ${job.input.timeoutMs}ms)`,
        );

        const timeout = AbortSignal.timeout(job.input.timeoutMs);
        const combined = AbortSignal.any([signal, timeout]);

        try {
          const data = await simulatedFetch(job.input.url, combined, 300);
          console.log(`  Fetch SUCCESS`);
          return await complete(async () => ({ data }));
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            console.log(`  Fetch TIMED OUT`);
            return complete(async () => ({ timedOut: true }));
          }
          throw error;
        }
      },
    },

    "long-running-job": {
      // Configure shorter lease for demo (normally you'd use longer values)
      leaseConfig: { leaseMs: 500, renewIntervalMs: 200 },
      attemptHandler: async ({ job, complete }) => {
        const attempt = job.attempt;
        console.log(
          `[long-running-job] Task ${job.input.taskId}, attempt ${attempt}, duration ${job.input.durationMs}ms`,
        );

        await new Promise((r) => setTimeout(r, job.input.durationMs));

        console.log(`  Task completed on attempt ${attempt}`);
        return complete(async () => ({ completed: true, attempt }));
      },
    },
  },
});

const stopWorker = await worker.start();

// Scenario 1a: Cooperative timeout - completes in time
console.log("\n--- Scenario 1a: Cooperative Timeout (Success) ---");
console.log("Fetch completes before timeout.\n");

const fetch1 = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "fetch-with-timeout",
      input: { url: "/api/fast", timeoutMs: 500 }, // 500ms timeout, 300ms fetch
    });
  }),
);
const result1 = await client.waitForJobChainCompletion(fetch1, { timeoutMs: 5000 });
console.log(`Result: ${JSON.stringify(result1.output)}`);

// Scenario 1b: Cooperative timeout - times out
console.log("\n--- Scenario 1b: Cooperative Timeout (Timeout) ---");
console.log("Fetch times out before completing.\n");

const fetch2 = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "fetch-with-timeout",
      input: { url: "/api/slow", timeoutMs: 100 }, // 100ms timeout, 300ms fetch
    });
  }),
);
const result2 = await client.waitForJobChainCompletion(fetch2, { timeoutMs: 5000 });
console.log(`Result: ${JSON.stringify(result2.output)}`);

// Scenario 2: Hard timeout via lease (completes in time)
console.log("\n--- Scenario 2: Hard Timeout via Lease ---");
console.log("Job with leaseConfig completes within lease period.\n");

const longJob = await client.withNotify(async () =>
  sql.begin(async (_sql) => {
    const txSql = _sql as TransactionSql;
    return client.startJobChain({
      sql: txSql,
      typeName: "long-running-job",
      input: { taskId: "task-001", durationMs: 200 }, // 200ms work, 500ms lease
    });
  }),
);
const result3 = await client.waitForJobChainCompletion(longJob, { timeoutMs: 5000 });
console.log(`Result: ${JSON.stringify(result3.output)}`);

await stopWorker();
await sql.end();
await pgContainer.stop();
