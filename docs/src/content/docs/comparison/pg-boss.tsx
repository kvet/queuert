import { CompareMatrix } from "../../../components/CompareMatrix.tsx";
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
        <code>12.38.0</code>.
      </p>
    </blockquote>
    <CompareMatrix tools={["queuert", "pg-boss"]} />
    <h2>What pg-boss is</h2>
    <p>
      pg-boss is a <strong>Postgres-backed job queue</strong>. The mental model is messages routed
      through named queues, with rich policies attached to each queue (singleton, exclusive,
      strict-FIFO, throttling), retries with backoff, cron schedules, dead-letter queues, job
      dependency flows, and a supervisor that runs maintenance for you. In production since 2016,
      polling by default with opt-in <code>LISTEN/NOTIFY</code>, on Postgres or a
      Postgres-compatible database.
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
        <strong>Chain concepts</strong> like typed continuations, where each step's handler decides
        the next step at runtime, are central to Queuert because Queuert is a job-chain library.
        pg-boss added dependency flows in v12.19, but a flow is a set of jobs and their dependencies
        declared up front with <code>flow()</code>, not a chain that grows as each step completes —
        pg-boss is modeling queues, not chained execution.
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
        <code>{"schedule(name, cron, data, { tz })"}</code> with timezone support, RRULE
        expressions, and multiple schedules per queue.
      </li>
      <li>
        <strong>Dead letter queues.</strong> Set <code>deadLetter: 'dlq-name'</code> and
        final-failure jobs route there atomically; <code>redrive()</code> sends them back.
      </li>
      <li>
        <strong>Dependency flows.</strong> <code>flow()</code> creates a set of jobs with{" "}
        <code>dependsOn</code> edges in one transaction; a dependent job stays blocked until every
        parent completes.
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
        <strong>Maturity.</strong> In production since 2016, widely used, well-documented.
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
        (default 2s) unless you enable <code>useListenNotify</code> and <code>notify</code> on a
        queue; it then wakes on <code>LISTEN/NOTIFY</code> and keeps a slower poll as a backstop.
        With a notify adapter — <code>LISTEN/NOTIFY</code>, Redis, or NATS — Queuert workers wake
        when a row commits, typically within tens of milliseconds; without one, workers in other
        processes poll, every 60 s by default.
      </li>
      <li>
        <strong>Failure shape.</strong> In pg-boss, final failure routes the job to a dead-letter
        queue (or its own <code>failed</code> set). In Queuert, the error stays on the job as{" "}
        <code>lastAttemptError</code>; what happens next is an application decision. These are
        direct consequences of "queue" vs. "job-chain library."
      </li>
      <li>
        <strong>Storage backends.</strong> pg-boss runs on Postgres and Postgres-compatible
        databases (CockroachDB, Citus, PGlite). Queuert works against Postgres or SQLite.
      </li>
    </ul>
    <h2>Transactional consistency, both ends</h2>
    <p>
      Both pg-boss and Queuert store state in your Postgres, so the question isn't "is the state
      nearby?" — it's "is the API wired to commit your domain write atomically with the queue's
      state mutation?" pg-boss offers it at both ends as options you turn on per call or per worker;
      in Queuert it is the only path.
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
      have to write their own <code>executeSql</code> shim), and a call that omits{" "}
      <code>{"{ db }"}</code> runs on pg-boss's own pool — dual-write is the default unless every
      call site remembers to pass it.
    </p>
    <p>
      Queuert's <code>createChain</code> writes into your DB transaction structurally — there is no
      enqueue path that bypasses it:
    </p>
    <Code lang="ts">{`
      await withTxHooks(async (txHooks) =>
        sql.begin(async (txSql) => {
          const [user] = await txSql\`insert into users (email) values (\${email}) returning id\`;
          await client.createChain({
            txSql,
            txHooks,
            typeName: "send-welcome-email",
            input: { userId: user.id },
          });
        }),
      );
    `}</Code>
    <h3>Processing</h3>
    <p>
      pg-boss documents at-least-once delivery: a job whose worker crashes or runs past{" "}
      <code>expireInSeconds</code> (default 15 min) is retried, so a handler can run twice. By
      default, <code>work()</code> runs the handler and then calls <code>complete()</code> on its
      own pool in a separate transaction, so domain writes the handler committed can commit twice.
    </p>
    <p>
      v12.32 added an opt-in <code>{"work(name, { transactional: true }, handler)"}</code> that
      closes this gap (see <a href="https://pgboss.io/api/workers">the workers docs</a>). pg-boss
      opens a transaction, passes it to the handler, and commits the job's completion in it; writes
      routed through that transaction commit or roll back with the completion, and a claim lost
      meanwhile rolls it back:
    </p>
    <Code lang="js">{`
      await boss.work("send-welcome-email", { transactional: true }, async ([job], tx) => {
        await tx.executeSql("insert into email_log (user_id) values ($1)", [job.data.userId]);
        await boss.send("log-sent", { ... }, { db: tx });
      });
    `}</Code>
    <p>
      The transaction stays open for the whole handler run and holds a pool connection, so pg-boss
      recommends it for handlers that finish in seconds and points long work back to the default
      worker with <code>{"complete(..., { db })"}</code>.
    </p>
    <p>
      Queuert's worker has no other mode. The handler does its work, then opens its own transaction
      with your database client and commits the outcome with <code>complete</code> inside it,
      together with its domain writes. Your handler's domain writes, the chain's completion, and the
      next step's <code>continueWith</code> all commit in one transaction; <code>complete</code>{" "}
      writes only if this attempt still owns the job, so a stale worker's transaction rolls back
      instead of double-committing. The worker lease, retry, and backoff stay in the worker — long
      work runs outside any transaction while the worker's heartbeat renews its lease:
    </p>
    <Code lang="ts">{`
      "send-welcome-email": {
        attemptHandler: async ({ job, complete }) =>
          withTxHooks(async (txHooks) =>
            sql.begin(async (txSql) => {
              await txSql\`insert into email_log (user_id) values (\${job.input.userId})\`;
              return complete({ txSql, txHooks, continueWith: { typeName: "log-sent", input: { ... } } });
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
      <li>Your multi-step work is a dependency graph you can declare up front.</li>
      <li>You value a decade of production deployment over newer designs.</li>
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
        You want long handlers that keep only the final commit inside a transaction, in your own
        database client's transaction rather than one the library opens.
      </li>
      <li>
        Your DB is the system of record and you'd rather not introduce queue concepts you don't
        need.
      </li>
    </ul>
    <p>
      If both shapes plausibly fit, the deciding question is usually whether typed chains and
      always-on transactional processing matter more than queue policies, or the other way around.
    </p>
  </>
);

export default Page;
