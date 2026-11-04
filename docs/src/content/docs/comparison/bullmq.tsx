import { CompareMatrix } from "../../../components/CompareMatrix.tsx";
import { QueuertSummary } from "../../../components/QueuertSummary.tsx";
import { comparedQueuertVersion } from "../../../data/comparison.ts";

export const meta = {
  title: "BullMQ",
  description:
    "How Queuert relates to BullMQ — different tools for different shapes of background work.",
};

const Page = () => (
  <>
    <p>
      <a href="https://github.com/taskforcesh/bullmq">BullMQ</a> is the most established
      Redis-backed job queue in the Node.js ecosystem, and since v6 it can also run on PostgreSQL.
      Queuert and BullMQ both run background work, but they approach the problem from different
      categories.
    </p>
    <blockquote>
      <p>
        Compared versions: Queuert <code>{comparedQueuertVersion}</code> and BullMQ{" "}
        <code>6.7.0</code>.
      </p>
    </blockquote>
    <CompareMatrix tools={["queuert", "bullmq"]} />
    <h2>What BullMQ is</h2>
    <p>
      BullMQ is a <strong>Redis-backed job queue</strong>. The mental model is messages on Redis
      lists and sorted sets, moved between states by atomic Lua scripts. Workers block on{" "}
      <code>BZPOPMIN</code> and process jobs in process or in sandboxed child processes. Since v6
      the same <code>Queue</code> / <code>Worker</code> / <code>FlowProducer</code> API also runs on
      a PostgreSQL backend, built on SQL functions and woken by <code>LISTEN/NOTIFY</code>. Comes
      with priority, rate limiting, parent/child flows (<code>FlowProducer</code>), job schedulers
      for cron, sandbox isolation, and cross-language SDKs (Python, Elixir, Rust, .NET, and a PHP
      producer) that share the same scripts.
    </p>
    <p>
      You install it, point it at Redis or Postgres, create queues, and <code>add</code> jobs.
      Workers either run in your process or in sandboxed child processes.
    </p>
    <QueuertSummary />
    <h2>They aren't directly comparable</h2>
    <p>BullMQ and Queuert model different problems:</p>
    <ul>
      <li>
        <strong>Queue concepts</strong> like priority, rate limiting, sandboxed processors, and
        atomic scripts are central to BullMQ because BullMQ is a high-throughput queue. They're
        absent from Queuert because Queuert isn't modeling messages through queues — it's modeling
        chained workflows tied to DB transactions.
      </li>
      <li>
        <strong>Chain concepts</strong> like typed continuations, blocker DAGs, and transactional
        enqueue tied to your DB are central to Queuert because Queuert is a job-chain library that
        lives in your DB. They're absent from BullMQ because BullMQ runs every operation on its own
        connection — in Redis, or in Postgres but outside your transactions.
      </li>
    </ul>
    <p>
      The narrow overlap is "both let you defer work into the background," possibly in the same
      Postgres. Beyond that, the shapes diverge.
    </p>
    <h2>What BullMQ is good at</h2>
    <ul>
      <li>
        <strong>Speed.</strong> On Redis, lists/sorted sets and Lua-script atomicity make BullMQ the
        fastest path among Node queue libraries on raw throughput and wakeup latency.{" "}
        <code>BZPOPMIN</code> typically wakes in sub-millisecond. BullMQ's docs put the Postgres
        backend at roughly 1.5–2× lower processing throughput.
      </li>
      <li>
        <strong>Sandboxed processors.</strong> Pass a <code>processFile</code> path; BullMQ runs
        handlers in separate Node processes (or worker threads) via a child pool. Real isolation and
        crash containment.
      </li>
      <li>
        <strong>Cross-language SDKs.</strong> Python, Elixir, Rust, and .NET workers, plus a PHP
        producer, share the same scripts. The stored state is the contract.
      </li>
      <li>
        <strong>Rich queue primitives.</strong> Priority (0–2,097,151), rate limiting (per queue;
        per group in BullMQ Pro), parent/child flows via <code>FlowProducer</code>, job schedulers
        with cron or fixed intervals, deduplication windows.
      </li>
      <li>
        <strong>Mature ecosystem.</strong> Bull Board (third-party OSS dashboard), Taskforce.sh
        dashboards, an HTTP proxy for platforms without a native SDK, broad deployment.
      </li>
    </ul>
    <p>
      These are what a <em>high-throughput queue</em> should be good at, and BullMQ invests heavily
      in them.
    </p>
    <h2>Differences worth knowing about</h2>
    <p>A few practical differences:</p>
    <ul>
      <li>
        <strong>Storage tier.</strong> On Redis, BullMQ's durability depends on your Redis
        configuration (RDB / AOF / fsync settings); its Postgres backend keeps jobs in a{" "}
        <code>bullmq</code> schema in your database. Queuert uses Postgres or SQLite; durability is
        whatever your DB gives you.
      </li>
      <li>
        <strong>Wakeup mechanism.</strong> On Redis, BullMQ's <code>BZPOPMIN</code> blocking pop
        wakes in sub-millisecond; on Postgres it uses <code>LISTEN/NOTIFY</code>. Queuert's{" "}
        <code>LISTEN/NOTIFY</code> (or Redis pub/sub, or NATS) wakes in tens of milliseconds.
      </li>
      <li>
        <strong>Transactional consistency.</strong> BullMQ runs every operation on its own
        connection — Redis, or its own <code>pg</code> pool on the Postgres backend — so both ends
        require application discipline. <em>Enqueue:</em> <code>add</code> can't join your DB
        transaction, even when the jobs live in the same Postgres. <em>Processing:</em>{" "}
        <a href="https://docs.bullmq.io/">BullMQ's docs</a> describe at-least-once delivery: a job
        whose worker crashes or loses its lock can be processed again, so processors must be
        idempotent. With Queuert, both halves commit inside your DB transaction; for DB-bound work,
        no outbox and no idempotency-key ritual.
      </li>
      <li>
        <strong>Sandboxing.</strong> BullMQ provides first-class sandboxed processors. Queuert runs
        handlers in your worker process; isolation is your application's concern.
      </li>
      <li>
        <strong>Cross-language workers.</strong> BullMQ has SDKs in several languages sharing the
        same stored state. Queuert workers are TypeScript, on Node.js or Bun.
      </li>
      <li>
        <strong>Failure shape.</strong> BullMQ's <code>failed</code> sorted set acts as the
        dead-letter queue; you re-process via <code>job.retry()</code>. Queuert leaves the error on
        the job as <code>lastAttemptError</code> and lets the application decide what to do next.
      </li>
    </ul>
    <h2>Choosing between them</h2>
    <p>
      <strong>Reach for BullMQ when:</strong>
    </p>
    <ul>
      <li>
        You already operate Redis and accept it as durable storage, or want BullMQ's queue features
        on the Postgres you already run.
      </li>
      <li>You need sub-millisecond wakeup latency and high raw throughput.</li>
      <li>
        You want sandboxed processors for crash containment, untrusted handlers, or memory limits.
      </li>
      <li>You need cross-language workers (Python / Elixir / Rust / .NET).</li>
      <li>Your problem is naturally queue-shaped: messages, lanes, routing, rate limits.</li>
    </ul>
    <p>
      <strong>Reach for Queuert when:</strong>
    </p>
    <ul>
      <li>
        Your problem is naturally chain-shaped: typed multi-step sequences where this job continues
        with that job, possibly waiting on others.
      </li>
      <li>You want enqueue to commit-or-rollback structurally with the data that triggered it.</li>
      <li>
        Your DB is already the system of record and you'd rather not introduce Redis as a second
        durable store.
      </li>
      <li>
        Sub-second (not sub-millisecond) wakeup latency via <code>LISTEN/NOTIFY</code> (or Redis /
        NATS) is enough.
      </li>
    </ul>
    <p>
      If you genuinely need both — high-throughput queue work <em>and</em> chain-shaped sequences
      tied to your DB — those are different concerns and deserve different tools. They aren't
      substitutes.
    </p>
  </>
);

export default Page;
