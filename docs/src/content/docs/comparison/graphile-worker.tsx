import { CompareMatrix } from "../../../components/CompareMatrix.tsx";
import { Code } from "../../../components/mdx/Code.tsx";
import { QueuertSummary } from "../../../components/QueuertSummary.tsx";
import { comparedQueuertVersion } from "../../../data/comparison.ts";

export const meta = {
  title: "Graphile Worker",
  description:
    "How Queuert relates to Graphile Worker — a SQL-native Postgres job queue and a job-chain library.",
};

const Page = () => (
  <>
    <p>
      <a href="https://worker.graphile.org">Graphile Worker</a> and Queuert both run background work
      stored in Postgres, and both let you enqueue inside your own transaction. They differ in what
      happens after enqueue: Graphile Worker runs single jobs as fast as Postgres allows; Queuert
      runs typed chains whose every step commits with your data.
    </p>
    <blockquote>
      <p>
        Compared versions: Queuert <code>{comparedQueuertVersion}</code> and Graphile Worker{" "}
        <code>0.18.0</code>.
      </p>
    </blockquote>
    <CompareMatrix tools={["queuert", "graphile-worker"]} />
    <h2>What Graphile Worker is</h2>
    <p>
      Graphile Worker is a <strong>SQL-native Postgres job queue</strong> for Node.js, in use since
      2019, MIT-licensed and sponsor-funded, with a paid, source-available Worker Pro preset. Jobs
      are rows added by the <code>graphile_worker.add_job()</code> SQL function — from your
      application, a trigger, or a database function — and executed by task functions in a Node
      worker that wakes on <code>LISTEN/NOTIFY</code>.
    </p>
    <p>
      You install it, point it at Postgres, write a task file per job name, and run the worker in
      its own process or inside your server.
    </p>
    <QueuertSummary />
    <h2>They aren't directly comparable</h2>
    <ul>
      <li>
        <strong>Queue concepts</strong> like named serial queues, <code>job_key</code> replace /
        throttle / dedupe modes, batch jobs, and a crontab are central to Graphile Worker because it
        is a queue. They are absent from Queuert because Queuert models chains tied to data, not
        messages through lanes.
      </li>
      <li>
        <strong>Chain concepts</strong> like typed continuations, blockers on other chains, and a
        completion that commits with the handler's domain writes are central to Queuert. They are
        absent from Graphile Worker: a task can add the next job itself, but there are no
        dependencies between jobs and no typed chain.
      </li>
    </ul>
    <p>
      The overlap is "both defer work into Postgres, inside your transaction, and can wake workers
      with <code>LISTEN/NOTIFY</code>." That overlap is larger than with most neighbors.
    </p>
    <h2>What Graphile Worker is good at</h2>
    <ul>
      <li>
        <strong>Enqueue from SQL.</strong> <code>add_job()</code> is a plain SQL function, so a
        trigger, a stored function, or any language that can run SQL can enqueue — inside whatever
        transaction calls it.
      </li>
      <li>
        <strong>Latency and throughput.</strong> Workers wake on <code>LISTEN/NOTIFY</code> as jobs
        are inserted, and the{" "}
        <a href="https://worker.graphile.org/docs/performance">performance page</a> reports
        six-figure jobs per second on a single machine with batching and the local queue enabled.
      </li>
      <li>
        <strong>Queue primitives.</strong> Built-in crontab, <code>run_at</code>, priority, named
        queues that run one job at a time, and <code>job_key</code> modes for debouncing,
        throttling, and deduplication.
      </li>
      <li>
        <strong>Batch jobs.</strong> An array payload lets a task settle each item separately; only
        the failed items are retried.
      </li>
      <li>
        <strong>Small footprint.</strong> Node.js and Postgres, nothing else; the worker can run
        inside your existing server process.
      </li>
    </ul>
    <h2>Differences worth knowing about</h2>
    <ul>
      <li>
        <strong>Crash recovery.</strong> Graphile Worker documents that jobs held by a crashed
        worker stay locked for at least 4 hours before another worker retries them; configurable
        timeouts and heartbeat recovery are Worker Pro features. Queuert workers hold a lease (60 s
        by default) renewed by a heartbeat, and an idle worker reclaims the jobs of a worker whose
        lease expired.
      </li>
      <li>
        <strong>Failure shape.</strong> After <code>max_attempts</code> (25 by default) a Graphile
        Worker job stays in the table as permanently failed, and the docs advise writing tasks so
        that no job permafails. Queuert keeps the error on the job as <code>lastAttemptError</code>{" "}
        and leaves what happens next to the application.
      </li>
      <li>
        <strong>Types.</strong> Graphile Worker task payloads are <code>unknown</code> unless you
        declare the global <code>GraphileWorker.Tasks</code> interface. Queuert infers inputs,
        outputs, continuations, and blockers from <code>defineJobTypes</code>.
      </li>
      <li>
        <strong>Storage backends.</strong> Graphile Worker is Postgres-only. Queuert works against
        Postgres, SQLite, or MySQL/MariaDB and Redis (both experimental).
      </li>
    </ul>
    <h2>Transactional consistency</h2>
    <h3>Enqueue</h3>
    <p>
      Both enqueue inside your transaction. In Graphile Worker you call the SQL function on your
      transaction's connection; the JavaScript <code>addJob</code> helper runs on Graphile Worker's
      own pool instead:
    </p>
    <Code lang="ts">{`
      await sql.begin(async (tx) => {
        const [user] = await tx\`insert into users (email) values (\${email}) returning id\`;
        await tx\`select graphile_worker.add_job('send_welcome_email', json_build_object('userId', \${user.id}))\`;
      });
    `}</Code>
    <p>
      Calling <code>add_job</code> needs database-owner privileges unless you wrap it in a{" "}
      <code>SECURITY DEFINER</code> function. Queuert's <code>createChain</code> takes your
      transaction context and is the only way to enqueue.
    </p>
    <h3>Processing</h3>
    <p>
      Here the two diverge. Graphile Worker runs the task, then deletes the job in a separate
      statement on its own pool. Its <a href="https://worker.graphile.org/docs/tasks">tasks docs</a>{" "}
      state:{" "}
      <em>
        "Neither <code>withPgClient</code> nor <code>query</code> methods create a database
        transaction. If you need a database transaction, you should do so yourself."
      </em>{" "}
      A transaction you open in the task commits before the job is completed, so a crash in between
      runs the task again — the <a href="https://worker.graphile.org/docs">docs</a> promise that{" "}
      <em>"each job will execute at least once."</em> A next job added from the task can be added
      twice unless it carries a <code>job_key</code>.
    </p>
    <p>
      In Queuert the handler opens its transaction with your database client and calls{" "}
      <code>complete</code> inside it, so the domain writes, the job's completion, and the next
      step's <code>continueWith</code> commit together; <code>complete</code> writes only if this
      attempt still owns the job. For DB-bound work, the second run never sees a half-committed
      first one.
    </p>
    <h2>Choosing between them</h2>
    <p>
      <strong>Reach for Graphile Worker when:</strong>
    </p>
    <ul>
      <li>Your work is single jobs, and you want the fastest Postgres queue with low latency.</li>
      <li>You want to enqueue from triggers, stored functions, or other languages through SQL.</li>
      <li>
        You want a crontab, priority, serial named queues, and job-key deduplication built in.
      </li>
      <li>Your tasks are idempotent, or can be made so with job keys.</li>
    </ul>
    <p>
      <strong>Reach for Queuert when:</strong>
    </p>
    <ul>
      <li>
        Your work is chain-shaped: typed steps that decide what comes next, possibly waiting on
        other chains.
      </li>
      <li>
        You want each step's domain writes and its completion to commit in one transaction, not just
        the enqueue.
      </li>
      <li>You want typed inputs and outputs without declaring a global task map by hand.</li>
      <li>
        You want a crashed worker's jobs retried once its lease expires, without a paid add-on.
      </li>
    </ul>
  </>
);

export default Page;
