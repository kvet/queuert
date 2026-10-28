import { CompareCards } from "../../../components/CompareCards.tsx";
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
      Redis-backed job queue in the Node.js ecosystem. Queuert and BullMQ both run background work,
      but they sit on different storage tiers and approach the problem from different categories.
    </p>
    <blockquote>
      <p>
        Compared versions: Queuert <code>{comparedQueuertVersion}</code> and BullMQ{" "}
        <code>5.76.6</code>.
      </p>
    </blockquote>
    <CompareCards tools={["queuert", "bullmq"]} />
    <h2>What BullMQ is</h2>
    <p>
      BullMQ is a <strong>Redis-backed job queue</strong>. The mental model is messages on Redis
      lists and sorted sets, moved between states by atomic Lua scripts. Workers block on{" "}
      <code>BZPOPMIN</code> and process jobs in process or in sandboxed child processes. Comes with
      priority, rate limiting, parent/child flows (<code>FlowProducer</code>), repeatable jobs /
      cron, sandbox isolation, and cross-language workers (Python, Elixir, PHP) that share the same
      Lua scripts.
    </p>
    <p>
      You install it, point it at Redis, create queues, and <code>add</code> jobs. Workers either
      run in your process or in sandboxed child processes.
    </p>
    <QueuertSummary />
    <h2>They aren't directly comparable</h2>
    <p>BullMQ and Queuert run on different storage tiers and model different problems:</p>
    <ul>
      <li>
        <strong>Queue concepts</strong> like priority, rate limiting, sandboxed processors, and
        atomic Lua scripts are central to BullMQ because BullMQ is a high-throughput Redis queue.
        They're absent from Queuert because Queuert isn't modeling messages-on-Redis — it's modeling
        chained workflows tied to DB transactions.
      </li>
      <li>
        <strong>Chain concepts</strong> like typed continuations, blocker DAGs, and transactional
        enqueue tied to your DB are central to Queuert because Queuert is a job-chain library that
        lives in your DB. They're absent from BullMQ because BullMQ lives in Redis, separate from
        your domain data.
      </li>
    </ul>
    <p>
      The narrow overlap is "both let you defer work into the background." Beyond that, the storage
      model and the shape diverge.
    </p>
    <h2>What BullMQ is good at</h2>
    <ul>
      <li>
        <strong>Speed.</strong> Redis lists/sorted sets and Lua-script atomicity make BullMQ the
        fastest path among Node queue libraries on raw throughput and wakeup latency.{" "}
        <code>BZPOPMIN</code> typically wakes in sub-millisecond.
      </li>
      <li>
        <strong>Sandboxed processors.</strong> Pass a <code>processFile</code> path; BullMQ runs
        handlers in separate Node processes (or worker threads) via a child pool. Real isolation and
        crash containment.
      </li>
      <li>
        <strong>Cross-language workers.</strong> Python, Elixir, and PHP clients share the same Lua
        scripts. The Redis state is the contract.
      </li>
      <li>
        <strong>Rich queue primitives.</strong> Priority (0–2,097,152), rate limiting (per queue,
        per key), parent/child flows via <code>FlowProducer</code>, repeat / cron schedules,
        deduplication windows.
      </li>
      <li>
        <strong>Mature ecosystem.</strong> Bull Board (third-party OSS dashboard), Taskforce.sh
        dashboards (paid), proxy package for serverless, broad deployment.
      </li>
    </ul>
    <p>
      These are what a <em>Redis queue</em> should be good at, and BullMQ invests heavily in them.
    </p>
    <h2>Differences worth knowing about</h2>
    <p>A few practical differences:</p>
    <ul>
      <li>
        <strong>Storage tier.</strong> BullMQ requires Redis; durability depends on your Redis
        configuration (RDB / AOF / fsync settings). Queuert uses Postgres or SQLite; durability is
        whatever your DB gives you.
      </li>
      <li>
        <strong>Wakeup mechanism.</strong> BullMQ's <code>BZPOPMIN</code> blocking pop wakes in
        sub-millisecond. Queuert's <code>LISTEN/NOTIFY</code> (or Redis pub/sub, or NATS) wakes in
        tens of milliseconds.
      </li>
      <li>
        <strong>Transactional consistency.</strong> BullMQ's queue lives in Redis, separate from
        your domain DB — so both ends require application discipline. <em>Enqueue:</em> dual-write
        between your DB and Redis is structural; transactional <code>add</code> isn't possible.{" "}
        <em>Processing:</em> BullMQ's{" "}
        <a href="https://docs.bullmq.io/bull/important-notes">Important Notes</a> describe
        at-least-once execution and warn that on lock expiration the job is "double processed" —
        handlers must be idempotent. With Queuert, both halves commit inside your DB transaction;
        for DB-bound work, no outbox and no idempotency-key ritual.
      </li>
      <li>
        <strong>Sandboxing.</strong> BullMQ provides first-class sandboxed processors. Queuert runs
        handlers in your worker process; isolation is your application's concern.
      </li>
      <li>
        <strong>Cross-language workers.</strong> BullMQ has SDKs in several languages sharing the
        same Redis state. Queuert workers are TypeScript, on Node.js or Bun.
      </li>
      <li>
        <strong>Failure shape.</strong> BullMQ's <code>failed</code> sorted set acts as the
        dead-letter queue; you re-process via <code>job.retry()</code>. Queuert leaves the error as
        data on the chain (<code>last_attempt_error</code>) and lets the application decide what to
        do next.
      </li>
    </ul>
    <h2>Choosing between them</h2>
    <p>
      <strong>Reach for BullMQ when:</strong>
    </p>
    <ul>
      <li>
        You already operate Redis and accept it as durable storage (or are fine with the
        loss-on-crash trade-off).
      </li>
      <li>You need sub-millisecond wakeup latency and high raw throughput.</li>
      <li>
        You want sandboxed processors for crash containment, untrusted handlers, or memory limits.
      </li>
      <li>You need cross-language workers (Python / Elixir / PHP).</li>
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
        Your DB is already the system of record and you'd rather not introduce a second durable
        store.
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
