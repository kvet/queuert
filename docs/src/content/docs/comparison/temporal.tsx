import { CompareCards } from "../../../components/CompareCards.tsx";
import { QueuertSummary } from "../../../components/QueuertSummary.tsx";
import { comparedQueuertVersion } from "../../../data/comparison.ts";

export const meta = {
  title: "Temporal",
  description:
    "How Queuert relates to Temporal — different categories that overlap on multi-step durable work.",
};

const Page = () => (
  <>
    <p>
      <a href="https://temporal.io">Temporal</a> and Queuert both express multi-step durable work,
      but they're different categories of tool. Temporal is a distributed workflow platform; Queuert
      is a job-chain library. Picking between them is mostly a question of how heavyweight a tool
      the problem actually warrants.
    </p>
    <blockquote>
      <p>
        Compared versions: Queuert <code>{comparedQueuertVersion}</code> and the Temporal TypeScript
        SDK <code>1.17.1</code>.
      </p>
    </blockquote>
    <CompareCards tools={["queuert", "temporal"]} />
    <h2>What Temporal is</h2>
    <p>
      Temporal is a <strong>distributed durable-execution platform</strong>. The mental model is
      workflow functions that run forever — deterministically, replayable from event history —
      execute side effects via separately-deployed Activities, and survive any crash by being
      replayed from their persistent history. Workflows can wait for hours or days, accept signals
      from outside, expose queries on their state, and spawn child workflows. Cross-language:
      official SDKs in Go, Java, Python, .NET, TypeScript, PHP, Ruby — all sharing the same server.
    </p>
    <p>
      You operate (or rent via Temporal Cloud) a separate Temporal server cluster — frontend,
      matching, history, and worker services backed by Cassandra, MySQL, or Postgres. Your
      application contains an SDK that polls task queues over gRPC, executes workflow code in a
      sandbox VM, and runs activities directly.
    </p>
    <QueuertSummary />
    <h2>Different tools — overlapping problem space</h2>
    <p>Temporal and Queuert come from different starting points and end up at different shapes:</p>
    <ul>
      <li>
        <strong>Temporal</strong> is a workflow platform. It trades operational complexity (a server
        cluster, bundled workflow code, a determinism contract) for unbounded durability — workflows
        can <code>await sleep('30 days')</code> and survive arbitrary crashes / redeploys — plus
        rich runtime interaction (signals / queries / updates) and cross-language workflows.
      </li>
      <li>
        <strong>Queuert</strong> is a job-chain library. It trades those things away for "you just
        have a Postgres" — no cluster to operate, no determinism constraint, no separate durability
        tier — and wins back transactional enqueue and structural simplicity.
      </li>
    </ul>
    <p>
      Both can express multi-step durable work that finishes in seconds-to-minutes. They diverge
      sharply outside that range: Temporal makes month-long sleeping workflows trivial; Queuert
      doesn't try to.
    </p>
    <h2>What Temporal is good at</h2>
    <ul>
      <li>
        <strong>In-line durable awaits.</strong> A workflow function can{" "}
        <code>await sleep('30 days')</code> or <code>await condition(...)</code> literally inside
        its body and pick up where it left off — call stack restored — after a server restart,
        deploy, or region failover. Event-sourced replay makes this work. (Queuert can also span
        30-day chains by scheduling the next step in the future; the difference is the programming
        model — "schedule the next step" vs. "await inside the same function.")
      </li>
      <li>
        <strong>Rich runtime interaction.</strong> Signals (fire-and-forget messages into a running
        workflow), queries (synchronous read of state), updates (RPC-shaped mutations with return
        values) are first-class.
      </li>
      <li>
        <strong>Cross-language workflows.</strong> A workflow defined in Go can call activities
        written in TypeScript and Python — same server, same task queues.
      </li>
      <li>
        <strong>Built-in scheduling and child workflows.</strong> Server-managed cron schedules with
        overlap policies, child workflows with parent-close policies, continue-as-new for unbounded
        loops.
      </li>
      <li>
        <strong>Battle-tested at scale.</strong> Production-deployed at Stripe, Snap, Coinbase, and
        many others.
      </li>
    </ul>
    <p>
      These are what a <em>distributed durable-execution platform</em> should be good at.
    </p>
    <h2>What Queuert is good at</h2>
    <ul>
      <li>
        <strong>Chained execution of typed jobs.</strong> Multi-step work as a typed sequence;
        inputs, outputs, continuations, and blockers infer end-to-end via{" "}
        <code>defineJobTypes</code>. Renames are compiler-checked.
      </li>
      <li>
        <strong>Transactional consistency, by design.</strong> <code>createChain</code> enqueues
        inside your DB transaction; handler completion + next-step <code>continueWith</code> commit
        in the same transaction as your domain writes. For DB-bound work, no outbox at enqueue and
        no idempotency-key ritual at processing — both halves are structural, not application
        discipline.
      </li>
      <li>
        <strong>Plain TypeScript handlers.</strong> No determinism constraint, no separate workflow
        bundle, no "you can't call <code>Date.now()</code> here." Job handlers are normal Node code
        that does normal Node things.
      </li>
      <li>
        <strong>Operational simplicity.</strong> No cluster to run, no separate persistence tier, no
        bundling step. Your application's Postgres is the entire backing store.
      </li>
      <li>
        <strong>Database as the system of record.</strong> Chain state lives next to your domain
        data. Joins, foreign keys, transactional consistency — all available.
      </li>
    </ul>
    <p>
      These are what a <em>job-chain library</em> should be good at.
    </p>
    <h2>Differences worth knowing about</h2>
    <p>A few practical differences:</p>
    <ul>
      <li>
        <strong>Where state lives.</strong> Temporal owns workflow state in its server cluster
        (Cassandra / MySQL / Postgres). Queuert keeps chain state in your application's DB. This
        affects everything downstream — backups, observability, joins, transactions.
      </li>
      <li>
        <strong>Transactional consistency.</strong> Because Temporal state lives elsewhere, both
        ends require application discipline. <em>Enqueue:</em> starting a workflow is a gRPC call to
        the Temporal Service, not a DB transaction. Temporal staff describe the dual-write trap
        explicitly in{" "}
        <a href="https://community.temporal.io/t/what-is-recommended-approach-on-starting-workflow-in-transaction/16248">
          their own forum
        </a>
        :{" "}
        <em>
          "this pattern will start the workflow even if the database needs to abort and retry the
          database transaction, leaving you in an inconsistent state where the workflow has started
          but the database doesn't know that happened."
        </em>{" "}
        <em>Processing:</em> activities are at-least-once — Temporal's{" "}
        <a href="https://docs.temporal.io/activity-definition">Activity Definition</a> docs state{" "}
        <em>
          "You should always make your business logic Activities idempotent in Temporal. Because
          Activities may be retried, these functions may be executed more than once."
        </em>{" "}
        The Temporal-blessed workaround is "workflow as the source of truth": start the workflow
        first, then write to the DB from inside an activity. That's a real architectural choice — it
        inverts the assumption many applications start from (that the DB is the system of record).
        With Queuert, both halves commit inside your DB transaction; the precondition is that your
        DB <em>is</em> the SoT for the data your handlers touch.
      </li>
      <li>
        <strong>Determinism.</strong> Temporal workflow code must be deterministic; you can't call{" "}
        <code>Date.now()</code>, <code>Math.random()</code>, <code>fetch</code>, or use plain{" "}
        <code>setTimeout</code>. Replay relies on this. Queuert handlers are plain TypeScript with
        no such constraint.
      </li>
      <li>
        <strong>Long durable waits.</strong> Temporal can <code>await sleep('30 days')</code> and
        survive crashes / deploys. Queuert can schedule the next attempt for a future time, but
        doesn't carry an awaiting call-stack across that wait.
      </li>
      <li>
        <strong>Runtime interaction.</strong> Temporal's signals / queries / updates are
        first-class. Queuert exposes <code>rescheduleJob</code> and <code>completeChain</code> but
        doesn't model an externally-interactive running process.
      </li>
      <li>
        <strong>Versioning.</strong> Bumping workflow code mid-flight in Temporal requires explicit{" "}
        <code>patched</code> / <code>getVersion</code> discipline. In Queuert, deploying new code
        doesn't risk replay drift because there's no replay.
      </li>
      <li>
        <strong>Operational footprint.</strong> Temporal: a multi-service cluster (frontend /
        matching / history / worker) plus Cassandra-class persistence, or pay for Temporal Cloud.
        Queuert: your existing Postgres.
      </li>
    </ul>
    <h2>Choosing between them</h2>
    <p>The decision is about scale and shape:</p>
    <p>
      <strong>Reach for Temporal when:</strong>
    </p>
    <ul>
      <li>
        You need long-lived workflows that survive arbitrary failures and run for days, weeks, or
        months.
      </li>
      <li>You need rich runtime interaction with running workflows — signals, queries, updates.</li>
      <li>
        You need cross-language workflows or activities (Go / Java / Python / .NET / TS / PHP /
        Ruby).
      </li>
      <li>
        The operational complexity of a separate cluster (or paying for Temporal Cloud) is
        acceptable.
      </li>
      <li>
        The determinism constraint and workflow bundling step are acceptable trade-offs for what you
        get.
      </li>
    </ul>
    <p>
      <strong>Reach for Queuert when:</strong>
    </p>
    <ul>
      <li>Your work is chain-shaped and bounded — finishes in seconds-to-minutes per chain.</li>
      <li>You want transactional enqueue with your DB.</li>
      <li>You don't want to operate (or pay for) a separate workflow cluster.</li>
      <li>
        Plain TypeScript handlers with no determinism contract are worth more than long-lived{" "}
        <code>await sleep('30d')</code>.
      </li>
      <li>
        Your DB is the system of record and you want chain state living next to your domain data.
      </li>
    </ul>
    <p>
      Both can express multi-step durable work. The difference is whether you need a workflow
      platform with replay and signals, or a small library that fits in a few tables next to your
      data.
    </p>
  </>
);

export default Page;
