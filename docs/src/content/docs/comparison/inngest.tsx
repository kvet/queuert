import { CompareCards } from "../../../components/CompareCards.tsx";
import { QueuertSummary } from "../../../components/QueuertSummary.tsx";
import { comparedQueuertVersion } from "../../../data/comparison.ts";

export const meta = {
  title: "Inngest",
  description:
    "How Queuert relates to Inngest — different categories that overlap on multi-step durable work.",
};

const Page = () => (
  <>
    <p>
      <a href="https://www.inngest.com">Inngest</a> and Queuert both express multi-step durable
      work, but they're different categories of tool. Inngest is an event-driven workflow platform;
      Queuert is a job-chain library. Their starting points and deployment shapes are different.
    </p>
    <blockquote>
      <p>
        Compared versions: Queuert <code>{comparedQueuertVersion}</code> and the Inngest SDK{" "}
        <code>inngest@4.3.0</code>.
      </p>
    </blockquote>
    <CompareCards tools={["queuert", "inngest"]} />
    <h2>What Inngest is</h2>
    <p>
      Inngest is an <strong>event-driven durable-function platform</strong>. The mental model is
      events that trigger functions; each function is composed of <code>step.run</code> blocks whose
      results are persisted server-side. Functions execute inside HTTP handlers in your application
      — there's no worker process — with the Inngest server invoking your <code>serve()</code>{" "}
      adapter and re-invoking it as steps complete. Built-in primitives for concurrency,
      rate-limiting, throttling, debouncing, priority, cron, <code>step.sleep('30d')</code>,{" "}
      <code>step.waitForEvent</code>, and fan-out via subscribe.
    </p>
    <p>
      You install the SDK, mount a <code>serve()</code> adapter at <code>/api/inngest</code>, and
      either rent the managed Inngest Cloud or operate the OSS Go server. Functions are defined in
      your app and discovered by the server when it pings your endpoint.
    </p>
    <QueuertSummary />
    <h2>Different tools — overlapping problem space</h2>
    <p>Both can express multi-step durable work, but they start from different places:</p>
    <ul>
      <li>
        <strong>Inngest</strong> starts from events. You publish events; functions subscribe to
        them. Multiple functions can subscribe to the same event (fan-out). Long-lived workflows
        pause via <code>step.sleep</code> / <code>step.waitForEvent</code> and resume when
        conditions are met. Functions execute as HTTP request/response cycles invoked by the Inngest
        server.
      </li>
      <li>
        <strong>Queuert</strong> starts from database transactions. You write data and start a chain
        in the same transaction. Continuations propagate forward via <code>continueWith</code>.
        Workers in your process pull and execute jobs.
      </li>
    </ul>
    <p>
      Both can model "a 5-step background workflow." The difference shows up in (1) how it's
      triggered, (2) where it executes, and (3) what runtime it requires.
    </p>
    <h2>What Inngest is good at</h2>
    <ul>
      <li>
        <strong>Event-driven workflows.</strong> Publishing an event can fan out to many subscribed
        functions. <code>{"step.waitForEvent('payment.completed', { match: '...' })"}</code> durably
        waits for a future event to arrive.
      </li>
      <li>
        <strong>Long-lived durable waits.</strong> <code>step.sleep('30 days')</code> survives
        restarts, redeploys, region failovers — the server handles re-invocation.
      </li>
      <li>
        <strong>Rich orchestration knobs.</strong> First-class concurrency limits (per-key,
        expression-keyed), rate limiting, throttling, debouncing, priority — directly on the
        function definition.
      </li>
      <li>
        <strong>HTTP-handler execution shape.</strong> Functions live next to your routes and run on
        whatever HTTP runtime you already have (Vercel, Cloudflare, Lambda, Express, etc.). No
        worker process to manage.
      </li>
      <li>
        <strong>Hosted option.</strong> Inngest Cloud handles the server-side concerns; the OSS Go
        server is the self-hosted alternative.
      </li>
      <li>
        <strong>Cross-language SDKs.</strong> TypeScript, Python, Go, Kotlin, Elixir, Rust.
      </li>
    </ul>
    <p>
      These are what a <em>managed event-driven workflow platform</em> should be good at.
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
        <strong>Operational simplicity.</strong> No platform to depend on, no service to operate.
        Your existing Postgres (or SQLite) is the entire backing store.
      </li>
      <li>
        <strong>Database as the system of record.</strong> Chain state lives next to your domain
        data. Same DB, same backups, same observability.
      </li>
      <li>
        <strong>Plain in-process workers.</strong> Handlers run in your Node process; closures over
        outer scope work normally; no per-step HTTP roundtrip cost.
      </li>
    </ul>
    <p>
      These are what a <em>job-chain library</em> should be good at.
    </p>
    <h2>Differences worth knowing about</h2>
    <p>A few practical differences:</p>
    <ul>
      <li>
        <strong>Trigger model.</strong> Inngest is event-first: you{" "}
        <code>{"inngest.send({ name, data })"}</code> and matching functions run. Queuert is
        transaction-first: you <code>{"client.createChain({ typeName, input })"}</code> inside a DB
        transaction.
      </li>
      <li>
        <strong>Where execution happens.</strong> Inngest functions run in your HTTP handlers,
        invoked by the Inngest server. Queuert handlers run in your worker process, pulled from the
        DB.
      </li>
      <li>
        <strong>Where state lives.</strong> Inngest server (managed or self-hosted) owns step state
        and event histories. Queuert keeps everything in your application's DB.
      </li>
      <li>
        <strong>Per-step cost.</strong> Each Inngest <code>step.run</code> is an HTTP roundtrip to
        the Inngest server (sync checkpointing). Queuert commits each attempt's outcome in one DB
        transaction — yours; a chain of 5 jobs is 5 DB transactions plus the worker's
        single-statement bookkeeping, no platform RTT.
      </li>
      <li>
        <strong>Long durable waits.</strong> Inngest's <code>step.sleep('30d')</code> and{" "}
        <code>step.waitForEvent</code> survive crashes / deploys. Queuert can schedule the next
        attempt for a future time, but doesn't carry an awaiting call-stack.
      </li>
      <li>
        <strong>Transactional consistency.</strong> Inngest state lives on the Inngest server — so
        both ends require application discipline. <em>Enqueue:</em> <code>inngest.send</code> posts
        over HTTP independently of your DB transaction; dual-write is the default.{" "}
        <em>Processing:</em> Inngest's own{" "}
        <a href="https://www.inngest.com/docs/guides/error-handling">Errors & Retries</a> doc tells
        users{" "}
        <em>
          "a step inserting a new user to the database is not idempotent while a step upserting a
          user is"
        </em>{" "}
        — <code>step.run</code> is at-least-once until the result reaches the server. With Queuert,
        both halves commit inside your DB transaction; for DB-bound work, no outbox and no
        idempotency-key ritual.
      </li>
      <li>
        <strong>Vendor / hosting story.</strong> Inngest Cloud is the easy path; self-hosting the
        OSS server is possible but newer. Queuert has no vendor — your existing DB is the entire
        dependency.
      </li>
    </ul>
    <h2>Choosing between them</h2>
    <p>
      <strong>Reach for Inngest when:</strong>
    </p>
    <ul>
      <li>
        Your work is naturally event-driven: webhooks fan out, long-pending workflows resume on a
        future event, durable sleeps measured in days.
      </li>
      <li>
        You want first-class concurrency / rate-limit / throttle / debounce knobs without writing
        them yourself.
      </li>
      <li>You're comfortable with Inngest Cloud (or operating the OSS server) as a dependency.</li>
      <li>HTTP-handler execution fits your runtime (Vercel / Cloudflare / Lambda / etc.).</li>
      <li>You can accept the dual-write story and use idempotency keys to make it safe.</li>
    </ul>
    <p>
      <strong>Reach for Queuert when:</strong>
    </p>
    <ul>
      <li>
        Your work is naturally transaction-driven: this DB write commits, then this background work
        follows.
      </li>
      <li>
        You want enqueue to commit-or-rollback structurally with your DB transaction — no dual-write
        window.
      </li>
      <li>You don't want to depend on a SaaS or operate a separate workflow server.</li>
      <li>
        Plain TypeScript handlers in your worker process are simpler than per-step HTTP roundtrips.
      </li>
      <li>Your DB is the system of record and you want chain state living there too.</li>
    </ul>
    <p>
      Both can express multi-step durable work. The forcing question is usually whether your problem
      is shaped more like "events trigger functions" or "transactions create chains" — and how
      comfortable you are with the platform/dependency that comes with the event-driven shape.
    </p>
  </>
);

export default Page;
