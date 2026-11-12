export type CompareMark = "yes" | "partial" | "no";

export const comparedQueuertVersion = "0.17.0";

type CompareCell = { mark?: CompareMark; text: string; footnote?: number };

export type CompareToolId =
  | "queuert"
  | "pg-boss"
  | "graphile-worker"
  | "bullmq"
  | "dbos"
  | "temporal"
  | "inngest";

type CompareTool = {
  id: CompareToolId;
  name: string;
  category: string;
  href?: string;
  summary?: string;
  version?: string;
  cells: Record<CompareRowId, CompareCell | undefined>;
};

export const compareRows = [
  { id: "storage", label: "State lives in" },
  { id: "operate", label: "Extra service to run" },
  { id: "enqueue", label: "Transactional enqueue" },
  { id: "completion", label: "Transactional completion" },
  { id: "chains", label: "Typed multi-step work" },
  { id: "fanIn", label: "Fan-in dependencies" },
  { id: "delayed", label: "Delayed work" },
  { id: "cron", label: "Built-in cron" },
  { id: "deadLetter", label: "Dead-letter queue" },
  { id: "priority", label: "Priority field" },
  { id: "rateLimit", label: "Rate limiting" },
  { id: "wakeup", label: "Wakeup" },
  { id: "durableWaits", label: "Durable in-code waits" },
  { id: "languages", label: "Worker languages" },
] as const;

type CompareRowId = (typeof compareRows)[number]["id"];

export const compareFootnotes: { id: number; text: string; href: string }[] = [
  {
    id: 1,
    text: "pg-boss v12.17 added a { db } option on send() and complete() with Knex, Kysely, Drizzle and Prisma bridges; it is opt-in per call.",
    href: "https://pgboss.io/api/adapters",
  },
  {
    id: 2,
    text: "pg-boss v12.32 added work({ transactional: true }): the handler's writes through the transaction pg-boss opens commit with the job's completion; it is off by default and the transaction spans the whole handler.",
    href: "https://pgboss.io/api/workers",
  },
  {
    id: 3,
    text: "BullMQ documents at-least-once delivery: a job whose worker crashes or loses its lock can be processed again, so processors must be idempotent.",
    href: "https://docs.bullmq.io/",
  },
  {
    id: 4,
    text: "Temporal community forum: starting a workflow inside a DB transaction can start it even if the transaction aborts.",
    href: "https://community.temporal.io/t/what-is-recommended-approach-on-starting-workflow-in-transaction/16248",
  },
  {
    id: 5,
    text: "Temporal: activities may be retried, so business-logic activities should be idempotent.",
    href: "https://docs.temporal.io/activity-definition",
  },
  {
    id: 6,
    text: "Inngest: a saved step.run result does not make external side effects exactly-once; a call can succeed and time out before Inngest records the result.",
    href: "https://www.inngest.com/docs/durable-execution/guides-and-advanced/error-handling",
  },
  {
    id: 7,
    text: "Graphile Worker: the add_job() SQL function joins whatever transaction calls it; the JavaScript addJob runs on Graphile Worker's own pool.",
    href: "https://worker.graphile.org/docs/sql-add-job",
  },
  {
    id: 8,
    text: "Graphile Worker deletes the job in its own statement after the task returns; withPgClient and query do not open a transaction.",
    href: "https://worker.graphile.org/docs/tasks",
  },
  {
    id: 9,
    text: "DBOS: enqueueInTransaction takes a node-postgres client in an open transaction, and that client must be connected to the DBOS system database.",
    href: "https://docs.dbos.dev/typescript/reference/client",
  },
  {
    id: 10,
    text: "DBOS: transaction steps commit the user's changes and the checkpoint in one database transaction; ordinary steps are at least once.",
    href: "https://docs.dbos.dev/typescript/tutorials/workflow-tutorial",
  },
];

export const compareTools: CompareTool[] = [
  {
    id: "queuert",
    name: "Queuert",
    category: "job-chain library",
    cells: {
      storage: { text: "Your database — PostgreSQL, or SQLite" },
      operate: { text: "None — your existing database" },
      enqueue: { mark: "yes", text: "createChain writes in your transaction" },
      completion: { mark: "yes", text: "complete commits with your domain writes" },
      chains: { mark: "yes", text: "continueWith, types inferred end to end" },
      fanIn: { mark: "yes", text: "Typed blockers on other chains" },
      delayed: { mark: "yes", text: "schedule, reschedule" },
      cron: { mark: "no", text: "A chain schedules its successor" },
      deadLetter: { mark: "no", text: "Errors stay on the job as lastAttemptError" },
      priority: { mark: "no", text: "Partition job types across workers" },
      rateLimit: { mark: "no", text: "Not provided" },
      wakeup: { text: "LISTEN/NOTIFY, Redis or NATS — tens of ms; polling fallback" },
      durableWaits: { mark: "no", text: "Schedule the next job instead" },
      languages: { text: "TypeScript on Node.js and Bun" },
    },
  },
  {
    id: "pg-boss",
    name: "pg-boss",
    category: "job queue",
    href: "/comparison/pg-boss/",
    summary: "A Postgres job queue with dependency flows and opt-in transactional workers.",
    version: "v12.38.0",
    cells: {
      storage: { text: "PostgreSQL, CockroachDB, Citus or PGlite" },
      operate: { text: "None — your PostgreSQL" },
      enqueue: { mark: "partial", text: "Opt-in { db } per call", footnote: 1 },
      completion: { mark: "partial", text: "Opt-in transactional work()", footnote: 2 },
      chains: { mark: "partial", text: "flow() declares a dependency graph up front" },
      fanIn: { mark: "yes", text: "dependsOn in flow()" },
      delayed: { mark: "yes", text: "sendAfter" },
      cron: { mark: "yes", text: "schedule() with time zones" },
      deadLetter: { mark: "yes", text: "deadLetter queue option" },
      priority: { mark: "yes", text: "priority option on send" },
      rateLimit: { mark: "partial", text: "sendThrottled / sendDebounced per key" },
      wakeup: { text: "Polling every 2 s; opt-in LISTEN/NOTIFY per queue" },
      durableWaits: { mark: "no", text: "Not provided" },
      languages: { text: "Node.js and Bun" },
    },
  },
  {
    id: "graphile-worker",
    name: "Graphile Worker",
    category: "job queue",
    href: "/comparison/graphile-worker/",
    summary: "A SQL-native Postgres job queue. Transactional enqueue, separate completion.",
    version: "v0.18.0",
    cells: {
      storage: { text: "PostgreSQL" },
      operate: { text: "None — your PostgreSQL" },
      enqueue: { mark: "partial", text: "add_job() SQL in your transaction", footnote: 7 },
      completion: { mark: "no", text: "Completed in a separate statement", footnote: 8 },
      chains: { mark: "no", text: "A task can add the next job itself" },
      fanIn: { mark: "no", text: "Not provided" },
      delayed: { mark: "yes", text: "run_at" },
      cron: { mark: "yes", text: "Built-in crontab" },
      deadLetter: { mark: "no", text: "Permanently failed jobs stay in the table" },
      priority: { mark: "yes", text: "priority, lower runs first" },
      rateLimit: { mark: "no", text: "Not provided" },
      wakeup: { text: "LISTEN/NOTIFY; 2 s poll for future jobs" },
      durableWaits: { mark: "no", text: "Not provided" },
      languages: { text: "Node.js; any language enqueues via SQL" },
    },
  },
  {
    id: "bullmq",
    name: "BullMQ",
    category: "job queue",
    href: "/comparison/bullmq/",
    summary: "A Redis or Postgres job queue. Enqueue runs outside your transaction.",
    version: "v6.7.0",
    cells: {
      storage: { text: "Redis, or PostgreSQL since v6" },
      operate: { text: "Redis with persistence, or none on PostgreSQL" },
      enqueue: { mark: "no", text: "add() runs on BullMQ's own connection" },
      completion: { mark: "no", text: "At-least-once; idempotent handlers", footnote: 3 },
      chains: { mark: "partial", text: "FlowProducer parent/child flows" },
      fanIn: { mark: "partial", text: "A parent waits for its children" },
      delayed: { mark: "yes", text: "delay option" },
      cron: { mark: "yes", text: "Job schedulers" },
      deadLetter: { mark: "partial", text: "The failed set, re-run with retry()" },
      priority: { mark: "yes", text: "priority 0–2,097,151" },
      rateLimit: { mark: "partial", text: "Per queue; per group in BullMQ Pro" },
      wakeup: { text: "BZPOPMIN on Redis, LISTEN/NOTIFY on PostgreSQL" },
      durableWaits: { mark: "no", text: "Not provided" },
      languages: { text: "Node.js, Bun, Python, Elixir, Rust, .NET; PHP producer" },
    },
  },
  {
    id: "dbos",
    name: "DBOS",
    category: "durable workflow library",
    href: "/comparison/dbos/",
    summary: "A Postgres durable-workflow library. Replayed functions instead of typed chains.",
    version: "TS SDK v5.4.0",
    cells: {
      storage: { text: "PostgreSQL, a system database by default" },
      operate: { text: "None — paid Conductor for fleet recovery" },
      enqueue: { mark: "partial", text: "Opt-in, on the system database", footnote: 9 },
      completion: {
        mark: "yes",
        text: "Transaction steps commit with the checkpoint",
        footnote: 10,
      },
      chains: { mark: "yes", text: "Deterministic workflow code calling steps" },
      fanIn: { mark: "yes", text: "waitAll / waitFirst on child workflows" },
      delayed: { mark: "yes", text: "delaySeconds, DBOS.sleep" },
      cron: { mark: "yes", text: "Stored schedules with time zones" },
      deadLetter: { mark: "partial", text: "A status after 100 recovery attempts" },
      priority: { mark: "yes", text: "priority on every queue" },
      rateLimit: { mark: "yes", text: "Per queue and per partition" },
      wakeup: { text: "Queues poll, every 1 s at the fastest" },
      durableWaits: { mark: "yes", text: "sleep, recv, getEvent, streams" },
      languages: { text: "TypeScript, Python, Go, Java" },
    },
  },
  {
    id: "temporal",
    name: "Temporal",
    category: "workflow platform",
    href: "/comparison/temporal/",
    summary: "A distributed workflow platform. Both model multi-step durable work.",
    version: "TS SDK v1.25.0",
    cells: {
      storage: { text: "Temporal cluster (Cassandra, MySQL or PostgreSQL) or Temporal Cloud" },
      operate: { text: "Multi-service cluster, or Temporal Cloud" },
      enqueue: { mark: "no", text: "Starting a workflow is a gRPC call", footnote: 4 },
      completion: { mark: "no", text: "Activities are at-least-once", footnote: 5 },
      chains: { mark: "yes", text: "Deterministic workflow code" },
      fanIn: { mark: "yes", text: "Await several activities or child workflows" },
      delayed: { mark: "yes", text: "sleep() inside the workflow" },
      cron: { mark: "yes", text: "Server-managed schedules" },
      deadLetter: { text: "Failures are handled in workflow code" },
      priority: { mark: "yes", text: "priorityKey with fairness keys" },
      rateLimit: { mark: "partial", text: "Activity dispatch per worker or task queue" },
      wakeup: { text: "Workers poll task queues on the server" },
      durableWaits: { mark: "yes", text: "sleep, condition, signals" },
      languages: { text: "Go, Java, TypeScript, Python, .NET and more" },
    },
  },
  {
    id: "inngest",
    name: "Inngest",
    category: "workflow platform",
    href: "/comparison/inngest/",
    summary: "An event-driven workflow platform. Different trigger model.",
    version: "SDK v4.26.2",
    cells: {
      storage: { text: "Inngest server — Inngest Cloud or self-hosted" },
      operate: { text: "Inngest Cloud, or the OSS server" },
      enqueue: { mark: "no", text: "inngest.send posts over HTTP" },
      completion: { mark: "no", text: "step.run is at-least-once", footnote: 6 },
      chains: { mark: "yes", text: "Functions made of steps" },
      fanIn: { mark: "yes", text: "Await parallel steps" },
      delayed: { mark: "yes", text: "step.sleep()" },
      cron: { mark: "yes", text: "Cron-triggered functions" },
      deadLetter: { text: "onFailure handlers and bulk replay" },
      priority: { mark: "yes", text: "priority on the function" },
      rateLimit: { mark: "yes", text: "Rate limit, throttle, debounce" },
      wakeup: { text: "The server calls your HTTP handler or Connect worker" },
      durableWaits: { mark: "yes", text: "step.sleep, step.waitForEvent" },
      languages: { text: "TypeScript, Python, Go" },
    },
  },
];

export const compareNeighbors = compareTools.flatMap((tool) =>
  tool.href !== undefined && tool.summary !== undefined
    ? [{ name: tool.name, href: tool.href, summary: tool.summary }]
    : [],
);
