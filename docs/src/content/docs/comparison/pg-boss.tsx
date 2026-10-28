import { CompareCards } from "../../../components/CompareCards.tsx";
import { Code } from "../../../components/mdx/Code.tsx";
import { QueuertSummary } from "../../../components/QueuertSummary.tsx";
import { comparedQueuertVersion } from "../../../data/comparison.ts";

export const meta = {
  title: "pg-boss",
  description:
    "How Queuert relates to pg-boss — different tools for different shapes of background work.",
};

const Page = () => (
  <>
    <p>
      <a href="https://github.com/timgit/pg-boss">pg-boss</a> and Queuert both run background work
      and both store it in Postgres. They aren't the same kind of tool, and choosing between them is
      mostly a question of which kind you need.
    </p>
    <blockquote>
      <p>
        Compared versions: Queuert <code>{comparedQueuertVersion}</code> and pg-boss{" "}
        <code>12.18.2</code>.
      </p>
    </blockquote>
    <CompareCards tools={["queuert", "pg-boss"]} />
    <h2>What pg-boss is</h2>
    <p>
      pg-boss is a <strong>Postgres-backed job queue</strong>. The mental model is messages routed
      through named queues, with rich policies attached to each queue (singleton, exclusive,
      strict-FIFO, throttling), retries with backoff, cron schedules, dead-letter queues, and a
      supervisor that runs maintenance for you. Seven years of production use, polling-based,
      Postgres-only.
    </p>
    <p>
      You install it, point it at Postgres, create queues, and <code>send</code> jobs to them.
      Workers poll those queues and run handlers.
    </p>
    <QueuertSummary />
    <h2>They aren't directly comparable</h2>
    <p>
      It's tempting to ask "does Queuert have a DLQ?" or "does pg-boss support transactional
      outbox?" and conclude one of them is missing features. That framing doesn't fit:
    </p>
    <ul>
      <li>
        <strong>Queue concepts</strong> like DLQs, queue policies, named lanes, and rate limits are
        central to pg-boss because pg-boss is a queue. They are absent from Queuert because Queuert
        isn't modeling messages-through-lanes — it's modeling chains tied to data.
      </li>
      <li>
        <strong>Chain concepts</strong> like typed continuations, blocker DAGs, and transactional
        enqueue are central to Queuert because Queuert is a job-chain library. They are absent from
        pg-boss because pg-boss isn't modeling chained execution — it's modeling queues.
      </li>
    </ul>
    <p>
      The narrow overlap is "both let you defer work into the background and persist it in Postgres
      so it survives crashes." Beyond that, the shapes diverge.
    </p>
    <h2>What pg-boss is good at</h2>
    <ul>
      <li>
        <strong>Queue semantics out of the box.</strong> Six policies (<code>standard</code>,{" "}
        <code>short</code>, <code>singleton</code>, <code>stately</code>, <code>exclusive</code>,{" "}
        <code>key_strict_fifo</code>) enforced at the schema level via partial unique indexes. "At
        most one active per key," "strict FIFO per key with head-of-line blocking" — first-class, no
        application code.
      </li>
      <li>
        <strong>Built-in cron scheduling.</strong>{" "}
        <code>{"schedule(name, cron, data, { tz })"}</code> with timezone support, multiple
        schedules per queue.
      </li>
      <li>
        <strong>Dead letter queues.</strong> Set <code>deadLetter: 'dlq-name'</code> and
        final-failure jobs route there atomically.
      </li>
      <li>
        <strong>Throttle / debounce primitives.</strong> <code>sendThrottled</code> /{" "}
        <code>sendDebounced</code> with per-key time windows.
      </li>
      <li>
        <strong>Built-in supervisor.</strong> Cleanup, retention, and timeout detection run without
        you scheduling anything.
      </li>
      <li>
        <strong>Maturity.</strong> Seven years of deployment, widely used, well-documented.
      </li>
    </ul>
    <p>
      These are what a <em>queue</em> should be good at, and pg-boss invests heavily in them.
    </p>
    <h2>Differences worth knowing about</h2>
    <p>
      A few practical differences are worth calling out — not as scorecard rows, but as things you'd
      hit operationally:
    </p>
    <ul>
      <li>
        <strong>Wakeup mechanism.</strong> pg-boss polls every <code>pollingIntervalSeconds</code>{" "}
        (default 2s); that's the floor on enqueue→dequeue latency. Queuert listens on{" "}
        <code>LISTEN/NOTIFY</code> (or Redis / NATS), so workers wake when a row commits — typically
        tens of milliseconds.
      </li>
      <li>
        <strong>Failure shape.</strong> In pg-boss, final failure routes the job to a dead-letter
        queue (or its own <code>failed</code> set). In Queuert, failure stays as data on the chain (
        <code>last_attempt_error</code>); what happens next is an application decision. These are
        direct consequences of "queue" vs. "job-chain library."
      </li>
      <li>
        <strong>Storage backends.</strong> pg-boss is Postgres-only. Queuert works against Postgres
        or SQLite (experimental), or an in-process adapter for tests / single-process apps.
      </li>
    </ul>
    <h2>Transactional consistency, both ends</h2>
    <p>
      Both pg-boss and Queuert store state in your Postgres, so the question isn't "is the state
      nearby?" — it's "is the API wired to commit your domain write atomically with the queue's
      state mutation?" pg-boss requires per-call discipline at one end and offers no equivalent at
      the other; Queuert is structural at both.
    </p>
    <h3>Enqueue</h3>
    <p>
      pg-boss v12.17 (April 2026) added a <code>{"{ db }"}</code> option on <code>send</code> with
      bridge adapters for Knex / Kysely / Drizzle / Prisma to share the user's transaction:
    </p>
    <Code lang="ts">{`
      await prisma.$transaction(async (tx) => {
        await prisma.user.create({ data: { ... } });
        await boss.send("welcome-email", { ... }, { db: fromPrisma(tx) });
      });
    `}</Code>
    <p>
      It works, but it's per-call discipline: the adapter set is fixed (raw <code>pg</code> users
      have to write their own <code>IDatabase</code> shim), and most pg-boss code in the wild
      predates v12.17 and uses pg-boss's own pool — meaning dual-write is the default unless every
      call site remembers to pass <code>{"{ db }"}</code>.
    </p>
    <p>
      Queuert's <code>createChain</code> writes into your DB transaction structurally — there is no
      enqueue path that bypasses it:
    </p>
    <Code lang="ts">{`
      await withTransactionHooks(async (transactionHooks) =>
        db.transaction(async (tx) => {
          await tx.users.create({ ... });
          await client.createChain({
            tx,
            transactionHooks,
            typeName: "send-welcome-email",
            input: { ... },
          });
        }),
      );
    `}</Code>
    <h3>Processing</h3>
    <p>
      This is where the gap is sharper. pg-boss's README markets{" "}
      <em>"Exactly-once job delivery"</em> — but that phrase refers specifically to{" "}
      <code>SKIP LOCKED</code> on the fetch path (two workers can't claim the same row atomically).
      It does NOT mean handler-to-completion is exactly-once. Under <code>work()</code>, the handler
      runs, returns, and pg-boss then calls <code>complete()</code> against its own pool in a
      separate transaction (see{" "}
      <a href="https://github.com/timgit/pg-boss/blob/master/src/manager.ts">
        <code>src/manager.ts</code>
      </a>
      ). If your handler commits domain writes and the worker crashes before <code>complete()</code>{" "}
      lands (or the lease expires via <code>expireInSeconds</code>, default 15 min), the job is
      re-fetched and the handler runs again — domain writes commit twice.
    </p>
    <p>
      v12.17 (April 2026) added <code>{"{ db }"}</code> on <code>complete()</code> (and{" "}
      <code>fetch()</code>, <code>fail()</code>, etc.), so the <em>primitives</em> for atomic
      completion exist — you can call <code>{"complete(jobId, output, { db: tx })"}</code> inside
      your domain transaction and the job's state flips in the same commit. But the{" "}
      <code>work()</code> worker loop doesn't surface them: to actually fuse "handler tx" with
      "completion tx," you have to opt out of <code>work()</code>, write your own <code>fetch</code>{" "}
      + handler + <code>{"complete(..., { db: tx })"}</code> loop, and re-implement lease, retry,
      and backoff yourself. Atomic processing is possible, but it's a parallel API you build — for
      code using the supported <code>work()</code> worker, idempotency at processing is application
      discipline.
    </p>
    <p>
      Queuert's supported worker is built around this. The handler does its work, then opens its own
      transaction and commits the outcome with <code>complete</code> inside it, together with its
      domain writes. Your handler's domain writes, the chain's completion, and the next step's{" "}
      <code>continueWith</code> all commit in one transaction; <code>complete</code> writes only if
      this attempt still owns the job, so a stale worker's transaction rolls back instead of
      double-committing. Attempt timeouts, heartbeat, retry, and backoff stay in the worker — long
      work runs outside any transaction while the worker's heartbeat extends the attempt:
    </p>
    <Code lang="ts">{`
      "send-welcome-email": {
        attemptHandler: async ({ job, complete }) =>
          withTransactionHooks(async (transactionHooks) =>
            sql.begin(async (txSql) => {
              await txSql\`insert into email_log (user_id) values (\${job.input.userId})\`;
              return complete({ txSql, transactionHooks, continueWith: { typeName: "log-sent", input: { ... } } });
            }),
          ),
      },
    `}</Code>
    <p>
      If the worker crashes before that transaction commits, <em>nothing</em> from it lands —
      neither the domain write nor the chain progression. The next attempt starts fresh.
      At-least-once delivery becomes effectively exactly-once for DB-bound work.
    </p>
    <h3>What still needs care</h3>
    <p>
      The precondition is that your application DB is the system of record for the data your
      handlers touch. <em>External</em> side effects (the email actually being sent, a Stripe
      charge) still need idempotency keys — Queuert structurally fixes the DB half of at-least-once,
      not the network half. Cross-DB writes (handler writing to a separate microservice's database
      via API) still need an outbox at that boundary. For the chunk of your application where one
      Postgres is the source of truth, both outboxes go away.
    </p>
    <h2>Choosing between them</h2>
    <p>The decision is mostly about which shape of tool fits your problem:</p>
    <p>
      <strong>Reach for pg-boss when:</strong>
    </p>
    <ul>
      <li>Your problem is naturally queue-shaped: messages, lanes, routing, policies.</li>
      <li>
        You want first-class queue policies (singleton, exclusive, strict-FIFO) without building
        them yourself.
      </li>
      <li>You want cron, DLQ, and a maintenance supervisor in the box.</li>
      <li>Polling-interval wakeup latency is fine.</li>
      <li>You value seven years of production deployment over newer designs.</li>
    </ul>
    <p>
      <strong>Reach for Queuert when:</strong>
    </p>
    <ul>
      <li>
        Your problem is naturally chain-shaped: typed multi-step sequences where this job continues
        with that job, possibly waiting on others.
      </li>
      <li>
        You want the work that follows a transaction to commit-or-rollback structurally with the
        data that triggered it.
      </li>
      <li>
        You want sub-second wakeup latency via <code>LISTEN/NOTIFY</code> (or Redis / NATS).
      </li>
      <li>
        Your DB is the system of record and you'd rather not introduce queue concepts you don't
        need.
      </li>
    </ul>
    <p>
      If both shapes plausibly fit, the deciding question is usually whether transactional enqueue
      and typed chains matter more than queue policies, or the other way around. Neither is a
      feature the other side can add cheaply — they're consequences of what each tool fundamentally
      is.
    </p>
  </>
);

export default Page;
