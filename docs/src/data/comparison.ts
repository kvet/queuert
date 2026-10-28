export type CompareMark = "yes" | "partial" | "no";

export const comparedQueuertVersion = "0.12.0";

type CompareCell = { mark?: CompareMark; text: string; footnote?: number };

export type CompareToolId = "queuert" | "pg-boss" | "bullmq" | "temporal" | "inngest";

type CompareTool = {
  id: CompareToolId;
  name: string;
  category: string;
  href?: string;
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
    href: "https://github.com/timgit/pg-boss",
  },
  {
    id: 2,
    text: "pg-boss's work() loop calls complete() on its own pool in a separate transaction; atomic completion needs a hand-written fetch/complete loop.",
    href: "https://github.com/timgit/pg-boss/blob/master/src/manager.ts",
  },
  {
    id: 3,
    text: "BullMQ documents at-least-once execution: on lock expiration a job can be double processed, so handlers must be idempotent.",
    href: "https://docs.bullmq.io/bull/important-notes",
  },
  {
    id: 4,
    text: "Temporal staff: starting a workflow inside a DB transaction can start it even if the transaction aborts.",
    href: "https://community.temporal.io/t/what-is-recommended-approach-on-starting-workflow-in-transaction/16248",
  },
  {
    id: 5,
    text: "Temporal: activities may be retried, so business-logic activities should be idempotent.",
    href: "https://docs.temporal.io/activity-definition",
  },
  {
    id: 6,
    text: "Inngest: step.run is at-least-once until its result reaches the server; inserts are not idempotent, upserts are.",
    href: "https://www.inngest.com/docs/guides/error-handling",
  },
];

export const compareTools: CompareTool[] = [
  {
    id: "queuert",
    name: "Queuert",
    category: "job-chain library",
    cells: {
      storage: { text: "Your database — PostgreSQL or SQLite" },
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
    version: "v12.18.2",
    cells: {
      storage: { text: "PostgreSQL" },
      operate: { text: "None — your PostgreSQL" },
      enqueue: { mark: "partial", text: "Opt-in { db } per call", footnote: 1 },
      completion: { mark: "partial", text: "Not in the work() loop", footnote: 2 },
      chains: { mark: "no", text: "Single jobs on queues" },
      fanIn: { mark: "no", text: "Not provided" },
      delayed: { mark: "yes", text: "sendAfter" },
      cron: { mark: "yes", text: "schedule() with time zones" },
      deadLetter: { mark: "yes", text: "deadLetter queue option" },
      priority: { mark: "yes", text: "priority option on send" },
      rateLimit: { mark: "partial", text: "sendThrottled / sendDebounced per key" },
      wakeup: { text: "Polling, every 2 s by default" },
      durableWaits: { mark: "no", text: "Not provided" },
      languages: { text: "Node.js" },
    },
  },
  {
    id: "bullmq",
    name: "BullMQ",
    category: "job queue",
    href: "/comparison/bullmq/",
    version: "v5.76.6",
    cells: {
      storage: { text: "Redis" },
      operate: { text: "Redis, with persistence configured" },
      enqueue: { mark: "no", text: "Redis is separate from your database" },
      completion: { mark: "no", text: "At-least-once; idempotent handlers", footnote: 3 },
      chains: { mark: "partial", text: "FlowProducer parent/child flows" },
      fanIn: { mark: "partial", text: "A parent waits for its children" },
      delayed: { mark: "yes", text: "delay option" },
      cron: { mark: "yes", text: "Repeatable jobs" },
      deadLetter: { mark: "partial", text: "The failed set, re-run with retry()" },
      priority: { mark: "yes", text: "priority 0–2,097,152" },
      rateLimit: { mark: "yes", text: "Per queue and per key" },
      wakeup: { text: "BZPOPMIN blocking pop — sub-millisecond" },
      durableWaits: { mark: "no", text: "Not provided" },
      languages: { text: "Node.js, Python, Elixir, PHP" },
    },
  },
  {
    id: "temporal",
    name: "Temporal",
    category: "workflow platform",
    href: "/comparison/temporal/",
    version: "TS SDK v1.17.1",
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
      priority: undefined,
      rateLimit: undefined,
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
    version: "SDK v4.3.0",
    cells: {
      storage: { text: "Inngest server — Inngest Cloud or self-hosted" },
      operate: { text: "Inngest Cloud, or the OSS server" },
      enqueue: { mark: "no", text: "inngest.send posts over HTTP" },
      completion: { mark: "no", text: "step.run is at-least-once", footnote: 6 },
      chains: { mark: "yes", text: "Functions made of steps" },
      fanIn: { mark: "yes", text: "Await parallel steps" },
      delayed: { mark: "yes", text: "step.sleep()" },
      cron: { mark: "yes", text: "Cron-triggered functions" },
      deadLetter: { text: "Failures are handled in function code" },
      priority: { mark: "yes", text: "priority on the function" },
      rateLimit: { mark: "yes", text: "Rate limit, throttle, debounce" },
      wakeup: { text: "The server invokes your HTTP handler" },
      durableWaits: { mark: "yes", text: "step.sleep, step.waitForEvent" },
      languages: { text: "TypeScript, Python, Go, Kotlin, Elixir, Rust" },
    },
  },
];
