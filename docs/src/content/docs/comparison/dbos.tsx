import { CompareMatrix } from "../../../components/CompareMatrix.tsx";
import { QueuertSummary } from "../../../components/QueuertSummary.tsx";
import { comparedQueuertVersion } from "../../../data/comparison.ts";

export const meta = {
  title: "DBOS",
  description:
    "How Queuert relates to DBOS Transact — two Postgres-backed libraries for durable multi-step work with different programming models.",
};

const Page = () => (
  <>
    <p>
      <a href="https://www.dbos.dev">DBOS Transact</a> is the closest neighbor in this section. Both
      are libraries, not servers; both keep durable state in your Postgres; both commit database
      work atomically with their own bookkeeping. They differ in the programming model: DBOS replays
      a workflow function, Queuert runs a typed chain of jobs.
    </p>
    <blockquote>
      <p>
        Compared versions: Queuert <code>{comparedQueuertVersion}</code> and the DBOS TypeScript SDK{" "}
        <code>5.4.0</code>.
      </p>
    </blockquote>
    <CompareMatrix tools={["queuert", "dbos"]} />
    <h2>What DBOS is</h2>
    <p>
      DBOS Transact is a <strong>durable workflow library</strong>, MIT-licensed, from DBOS, Inc. A
      workflow is a registered function made of steps. DBOS checkpoints the workflow's inputs, each
      step's output, and its outcome to a Postgres system database (a separate database by default).
      After a crash the workflow function runs again from the top, completed steps return their
      recorded outputs, and execution resumes after the last completed step.
    </p>
    <p>
      Transaction steps run through a datasource (Knex, Kysely, Drizzle, TypeORM, Prisma,
      node-postgres, Postgres.js) and commit your changes with a checkpoint row in your application
      database. Around that sit queues with concurrency, rate limits and priority, stored cron
      schedules, durable <code>sleep</code>, and messaging between workflows. SDKs exist for
      TypeScript, Python, Go, and Java. The paid DBOS Transact Enterprise package and Conductor add
      distributed recovery, dashboards, retention, and automatic version upgrades.
    </p>
    <QueuertSummary />
    <h2>Different tools — overlapping problem space</h2>
    <ul>
      <li>
        <strong>DBOS</strong> models a workflow as one async function. Loops, branches, and waits
        are ordinary code; replay makes it durable, so the workflow function must be deterministic.
      </li>
      <li>
        <strong>Queuert</strong> models a workflow as a chain of jobs. Each job's handler is plain
        code that runs once per attempt; the next step is chosen with <code>continueWith</code> and
        stored as a row, so nothing is replayed and nothing has to be deterministic.
      </li>
    </ul>
    <p>
      Both express the same multi-step work. The choice is mostly whether you would rather write it
      as one function under a determinism contract, or as typed steps that hand off to each other.
    </p>
    <h2>What DBOS is good at</h2>
    <ul>
      <li>
        <strong>Workflows as ordinary functions.</strong> Await steps, loop, branch, and{" "}
        <code>DBOS.sleep</code> or <code>DBOS.recv</code> inside the same function body.
      </li>
      <li>
        <strong>Exactly-once database steps.</strong> The{" "}
        <a href="https://docs.dbos.dev/typescript/tutorials/transaction-tutorial">
          transactions docs
        </a>{" "}
        state that transaction steps{" "}
        <em>
          "execute as a single database transaction, atomically committing both user-defined changes
          and a DBOS checkpoint."
        </em>
      </li>
      <li>
        <strong>Queue controls.</strong> Global, per-worker and per-partition concurrency, rate
        limits per queue and per partition, priority, delays, deduplication IDs, and a debouncer.
      </li>
      <li>
        <strong>Schedules.</strong> Cron schedules stored in the database, with time zones, pause,
        resume, and backfill.
      </li>
      <li>
        <strong>Messaging and management.</strong> <code>send</code> / <code>recv</code>, events,
        and streams between workflows; cancel, resume, fork from a step, and rewind.
      </li>
      <li>
        <strong>Several languages.</strong> TypeScript, Python, Go, and Java SDKs, with
        OpenTelemetry spans for every workflow and step.
      </li>
    </ul>
    <h2>What Queuert is good at</h2>
    <ul>
      <li>
        <strong>Plain handlers.</strong> No determinism contract, no rule about the order steps
        start in, no replay. A handler does its work and commits its outcome.
      </li>
      <li>
        <strong>A typed chain contract.</strong> Inputs, outputs, continuations, and blockers on
        other chains are inferred end to end from <code>defineJobTypes</code>; renames are
        compiler-checked.
      </li>
      <li>
        <strong>Recovery built in.</strong> Workers hold leases, and an idle worker reclaims the
        jobs of a worker whose lease expired — no control plane to run or pay for.
      </li>
      <li>
        <strong>Everything in the open packages.</strong> The dashboard, OpenTelemetry, and every
        adapter ship as open-source packages.
      </li>
      <li>
        <strong>More storage and wakeup options.</strong> Postgres or SQLite (experimental), and
        workers that wake on <code>LISTEN/NOTIFY</code>, Redis, or NATS.
      </li>
    </ul>
    <h2>Differences worth knowing about</h2>
    <ul>
      <li>
        <strong>Determinism.</strong> The{" "}
        <a href="https://docs.dbos.dev/typescript/tutorials/workflow-tutorial">workflow docs</a>{" "}
        require that a workflow function{" "}
        <em>
          "if called multiple times with the same inputs, it should invoke the same steps with the
          same inputs in the same order."
        </em>{" "}
        Database access, API calls, random numbers, and the clock go in steps, and a violation
        throws <code>DBOSStepNondeterminismError</code>. Queuert handlers have no such rule.
      </li>
      <li>
        <strong>Deploys.</strong> DBOS tags each workflow with an application version, by default a
        hash of the workflow source, and recovers only workflows whose version matches the running
        code; the docs recommend blue-green deploys that drain the old version, or{" "}
        <code>DBOS.patch()</code> branches. Moving in-flight workflows to new code automatically is
        an Enterprise feature. Queuert jobs are rows with typed inputs, so workers on new code pick
        up pending jobs from earlier deploys; what stays compatible is each job type's input shape.
      </li>
      <li>
        <strong>Recovery across processes.</strong> Without Conductor, each DBOS process recovers
        the workflows tagged with its own executor ID when it restarts; Conductor detects an
        unhealthy executor and has another one recover its workflows. Queuert's idle workers reclaim
        an expired worker's jobs on their own.
      </li>
      <li>
        <strong>Transactional enqueue.</strong> <code>DBOS.startWorkflow</code> records the workflow
        in its own system-database transaction, independent of yours, and a workflow ID serves as
        the idempotency key. <code>enqueueInTransaction</code> joins a node-postgres transaction on
        the system database, so enqueue is atomic with your writes when your tables live there.
        Queuert's <code>createChain</code> takes your transaction context from any supported client,
        in your application database.
      </li>
      <li>
        <strong>Wakeup.</strong> DBOS queues are polled, at most every second by default with
        backoff under contention; a workflow started directly runs at once in the calling process.
        Queuert workers wake when a job commits: in the same process by default, across processes
        with a notify adapter; without one, workers in other processes poll.
      </li>
      <li>
        <strong>Durable in-code waits.</strong> DBOS waits inside the workflow with{" "}
        <code>sleep</code>, <code>recv</code>, and <code>getEvent</code>. Queuert schedules the next
        job for later, or blocks a chain on others.
      </li>
    </ul>
    <h2>Choosing between them</h2>
    <p>
      <strong>Reach for DBOS when:</strong>
    </p>
    <ul>
      <li>
        You want to write a workflow as one function, with durable sleeps and messages inside.
      </li>
      <li>You need queue controls — rate limits, partitioned concurrency, priority — built in.</li>
      <li>You want cron schedules and workflow management (fork, rewind) out of the box.</li>
      <li>You need SDKs beyond TypeScript, or plan to pay for Conductor for fleet operations.</li>
    </ul>
    <p>
      <strong>Reach for Queuert when:</strong>
    </p>
    <ul>
      <li>
        You would rather write typed steps that hand off to each other than keep a workflow function
        deterministic.
      </li>
      <li>Your chains wait on other chains, and you want those blockers typed.</li>
      <li>
        You want enqueue and completion in your own transaction with your own client, in your
        application database.
      </li>
      <li>You want recovery, a dashboard, and telemetry without a paid tier.</li>
      <li>You run on SQLite, or wake workers through Redis or NATS.</li>
    </ul>
  </>
);

export default Page;
