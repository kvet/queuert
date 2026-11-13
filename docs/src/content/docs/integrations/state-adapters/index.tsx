import { A } from "@solidjs/router";

import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { type OptionCard, OptionCards } from "../../../../components/integrations/OptionCards.tsx";

export const meta = {
  title: "State Adapters",
  description:
    "Where Queuert keeps chains, jobs and workers, and the StateAdapter interface every backend implements.",
};

const adapters: OptionCard[] = [
  {
    name: "PostgreSQL",
    status: { label: "recommended", tone: "accent" },
    pick: "Supports horizontal scaling and all Queuert features.",
    facts: [
      { label: "Package", value: "@queuert/postgres" },
      {
        label: "Clients",
        value: "pg · postgres.js · Bun SQL · Drizzle · Kysely · Prisma · Knex · MikroORM",
      },
      { label: "Locking", value: "FOR UPDATE SKIP LOCKED" },
    ],
    action: { label: "PostgreSQL state adapter", href: "/integrations/state-adapters/postgres/" },
  },
  {
    name: "SQLite",
    pick: "Suitable for local development, CLI tools, and embedded applications.",
    facts: [
      { label: "Package", value: "@queuert/sqlite" },
      {
        label: "Clients",
        value:
          "better-sqlite3 · node:sqlite · bun:sqlite · Bun SQL · Drizzle · Kysely · Prisma · Knex · MikroORM",
      },
      { label: "Locking", value: "single writer, writes serialized" },
    ],
    action: { label: "SQLite state adapter", href: "/integrations/state-adapters/sqlite/" },
  },
  {
    name: "MySQL / MariaDB",
    status: { label: "experimental", tone: "caution" },
    pick: "For applications whose data already lives in MySQL or MariaDB.",
    facts: [
      { label: "Package", value: "@queuert/mysql" },
      { label: "Clients", value: "mysql2" },
      { label: "Locking", value: "FOR UPDATE SKIP LOCKED" },
    ],
    action: { label: "MySQL / MariaDB state adapter", href: "/integrations/state-adapters/mysql/" },
  },
  {
    name: "Redis",
    status: { label: "experimental", tone: "caution" },
    pick: "Queuert's state on Redis or Redis Cluster, kept apart from your application data, which lives in another database.",
    facts: [
      { label: "Package", value: "@queuert/redis" },
      { label: "Clients", value: "ioredis · node-redis" },
      { label: "Locking", value: "optimistic, callbacks rerun on conflict" },
    ],
    action: { label: "Redis state adapter", href: "/integrations/state-adapters/redis/" },
  },
  {
    name: "Custom",
    pick: "A StateAdapter of your own, for another database engine.",
    facts: [
      { label: "Package", value: "your own" },
      { label: "Database", value: "any" },
      { label: "Checked by", value: "queuert/conformance" },
    ],
    action: { label: "Custom state adapter", href: "/integrations/state-adapters/custom/" },
  },
];

const members = (): FieldItem[] => [
  {
    name: "Transactions",
    description: (
      <>
        Run a callback in a transaction that commits on success and rolls back on error, tell
        whether a context is in an open transaction without a query, and run callbacks after the
        context's transaction commits or when it (or the savepoint the context belongs to) rolls
        back. The client and the worker register every side effect through these callbacks; see{" "}
        <A href="/guides/tx-hooks/">Tx Hooks</A>.
      </>
    ),
    extra: ["withTransaction", "isTransaction", "onTransactionCommit", "onTransactionRollback"],
  },
  {
    name: "Creating and finishing jobs",
    description: (
      <>
        Create chain heads (a deduplicated match comes back marked <code>deduplicated</code>),
        complete a job with its output or continue it with a successor, return jobs to pending (or
        move a blocked job's schedule), and delete chains.
      </>
    ),
    extra: ["createJobs", "continueJobs", "completeJobs", "rescheduleJobs", "deleteChains"],
  },
  {
    name: "Claiming work",
    description: (
      <>
        Claim due jobs of the given types for a worker with a live lease, skipping locked rows so no
        two callers get the same job, and report how long until the next pending job is due.
      </>
    ),
    extra: ["startJobAttempts", "getStartAttemptDelayMs"],
  },
  {
    name: "Blockers",
    description: (
      <>
        Add blocker chains to jobs, read a job's blockers, and move a completed chain's dependents
        to pending once all their blockers completed.
      </>
    ),
    extra: ["addJobsBlockers", "getJobBlockers", "unblockJobs"],
  },
  {
    name: "Worker leases",
    description: (
      <>
        Register a worker with a lease, extend the lease while it is live, and delete the worker row
        on stop.
      </>
    ),
    extra: ["startWorker", "extendWorkerLease", "stopWorker"],
  },
  {
    name: "Reads",
    description: (
      <>
        The lookups, counts and paginated lists behind the client's read-only methods and the
        dashboard.
      </>
    ),
    extra: [
      "getChains",
      "getJobs",
      "getWorkers",
      "getChainTypeNames",
      "getJobTypeNames",
      "countChainsByTypeName",
      "countJobsByTypeName",
      "countWorkers",
      "countWorkersByTypeName",
      "countRunningJobsByWorkerId",
      "listChains",
      "listJobs",
      "listChainJobs",
      "listBlockedJobs",
      "listWorkers",
      "listWorkerJobs",
    ],
  },
  {
    name: "Configuration and lifecycle",
    description: (
      <>
        <code>config</code> is how the adapter was configured, with defaults applied: the ID and
        limit settings used to generate and validate job and worker IDs and enforce the blocker
        limit. <code>close</code> releases internal resources and is idempotent;{" "}
        <code>[Symbol.asyncDispose]</code> calls it, so an adapter can be held with{" "}
        <code>await using</code>.
      </>
    ),
    extra: ["config", "close", "[Symbol.asyncDispose]"],
  },
];

const Page = () => (
  <>
    <p>
      State adapters abstract database operations for job persistence. They handle job creation,
      status transitions, attempt tracking, and queries. Every option below implements the same{" "}
      <code>StateAdapter</code> interface, which <code>createClient</code> and{" "}
      <code>createWorkerRunner</code> consume.
    </p>
    <OptionCards items={adapters} />

    <h2>The StateAdapter interface</h2>
    <p>
      <code>StateAdapter&lt;TTxContext, TJobId, TWorkerId&gt;</code> is exported from{" "}
      <code>queuert</code>. Its type parameters are the transaction context type, the job ID type
      and the worker ID type. Its members, by purpose:
    </p>
    <FieldList
      title="StateAdapter"
      actions={
        <A href="/api/core/type-aliases/stateadapter/" class="unstyled text-accent-fg">
          API reference →
        </A>
      }
      proseNames
      items={members()}
    />

    <h2>How adapters behave</h2>
    <ul>
      <li>
        <strong>Missing rows are not errors.</strong> An absent or already completed row is reported
        as <code>undefined</code> in the result position it belongs to, and the caller decides which
        error the user sees. Adapters still throw for driver errors and connection loss.
      </li>
      <li>
        <strong>Lookups return results in input order.</strong> Lookups by ID return one entry per
        requested ID, in input order.
      </li>
      <li>
        <strong>Constant round trips.</strong> The number of database operations a method executes
        does not depend on how many jobs it affects; array methods are batched, never looped.
      </li>
      <li>
        <strong>Writes are fenced.</strong> Worker writes need the <code>token</code> on the worker
        row; attempt-scoped writes need the job's <code>attemptToken</code>, which{" "}
        <code>startJobAttempts</code> sets anew on every claim.
      </li>
    </ul>

    <h2>Transaction context</h2>
    <p>
      The transaction context (<code>TTxContext</code>) represents an active transaction: the one
      your own database client opened and passed to <code>client.createChain</code> or a handler's{" "}
      <code>complete</code>, or one opened by <code>withTransaction</code>. Besides the transaction
      handle, it may carry the <code>txHooks</code> a provider registers commit and rollback
      callbacks on; mutating calls and <code>complete</code> require every field of the context, and
      reads take any part of it. Queuert itself opens transactions only for migrations, for the
      worker's registration, reclaims and stop, and in test helpers, never around job processing.
    </p>
  </>
);

export default Page;
