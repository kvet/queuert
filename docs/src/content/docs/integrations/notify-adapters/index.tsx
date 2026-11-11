import { A } from "@solidjs/router";

import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { type OptionCard, OptionCards } from "../../../../components/integrations/OptionCards.tsx";
import { Aside } from "../../../../components/mdx/Aside.tsx";

export const meta = {
  title: "Notify Adapters",
  description:
    "Wake workers in other processes the moment jobs are scheduled instead of polling, and the NotifyAdapter interface every backend implements.",
};

const adapters: OptionCard[] = [
  {
    name: "PostgreSQL",
    pick: "Uses PostgreSQL's built-in LISTEN/NOTIFY. No additional infrastructure beyond your existing PostgreSQL database.",
    facts: [
      { label: "Package", value: "@queuert/postgres" },
      { label: "Transport", value: "LISTEN / NOTIFY" },
      { label: "Drivers", value: "pg · postgres.js · Bun SQL" },
    ],
    action: { label: "PostgreSQL notify adapter", href: "/integrations/notify-adapters/postgres/" },
  },
  {
    name: "Redis",
    status: { label: "recommended", tone: "accent" },
    pick: "Recommended for production. Uses Redis pub/sub, publishing each batch from one Lua script.",
    facts: [
      { label: "Package", value: "@queuert/redis" },
      { label: "Transport", value: "pub/sub" },
      { label: "Drivers", value: "node-redis · ioredis · Bun" },
    ],
    action: { label: "Redis notify adapter", href: "/integrations/notify-adapters/redis/" },
  },
  {
    name: "NATS",
    status: { label: "experimental", tone: "caution" },
    pick: "Uses NATS core pub/sub. The adapter takes the NatsConnection directly.",
    facts: [
      { label: "Package", value: "@queuert/nats" },
      { label: "Transport", value: "core pub/sub" },
      { label: "Drivers", value: "@nats-io/transport-node" },
    ],
    action: { label: "NATS notify adapter", href: "/integrations/notify-adapters/nats/" },
  },
  {
    name: "Custom",
    pick: "A NotifyAdapter of your own, for another message broker.",
    facts: [
      { label: "Package", value: "your own" },
      { label: "Transport", value: "any broker" },
      { label: "Checked by", value: "queuert/conformance" },
    ],
    action: { label: "Custom notify adapter", href: "/integrations/notify-adapters/custom/" },
  },
];

const members = (): FieldItem[] => [
  {
    name: "Job scheduled",
    description: (
      <>
        Jobs of the given types are available for processing; wakes the workers that process them.
        Every listener receives each notification.
      </>
    ),
    extra: ["notifyJobsScheduled", "listenJobScheduled"],
  },
  {
    name: "Chain completed",
    description: <>The given chains have completed; wakes whoever is waiting on one of them.</>,
    extra: ["notifyChainsCompleted", "listenChainCompleted"],
  },
  {
    name: "Attempt lost",
    description: (
      <>
        The given jobs lost their attempts: they were reclaimed from a worker whose lease expired or
        that stopped, completed workerless, or their chain was deleted.
      </>
    ),
    extra: ["notifyJobAttemptsLost", "listenJobAttemptLost"],
  },
  {
    name: "Lifecycle",
    description: (
      <>
        <code>close</code> releases internal resources (shared subscriptions, listener registries)
        and cascades into the underlying provider, when there is one.{" "}
        <code>[Symbol.asyncDispose]</code> calls <code>close</code>, so an adapter can be held with{" "}
        <code>await using</code>.
      </>
    ),
    extra: ["close", "[Symbol.asyncDispose]"],
  },
];

const Page = () => (
  <>
    <p>
      Notify adapters handle pub/sub notifications for efficient job scheduling. When a job is
      created, workers in every process are notified immediately instead of polling. This reduces
      latency from seconds to milliseconds.
    </p>
    <OptionCards items={adapters} />

    <h2 id="default">Without a notify adapter</h2>
    <p>
      A client created without <code>notifyAdapter</code> delivers notifications in memory to
      itself: the worker runners created from it and its <code>awaitChain</code> calls wake the
      moment a transaction commits. Nothing crosses the process, or even the client: a worker runner
      in another process, or one built from a second client in the same process, polls the database
      every <code>pollIntervalMs</code>. No additional packages or infrastructure are required.
    </p>
    <Aside type="tip">
      A single process with one client needs no notify adapter. Once workers run in other processes,
      polling is still a valid choice for low-throughput workloads where millisecond latency is not
      critical; pass a shared adapter when it is.
    </Aside>

    <h2 id="notify-adapter-interface">The NotifyAdapter interface</h2>
    <p>
      <code>NotifyAdapter</code> is exported from <code>queuert</code>. It has three notification
      channels, each with a batched <code>notify*</code> method and a <code>listen*</code> method,
      plus <code>close</code>:
    </p>
    <FieldList
      title="NotifyAdapter"
      actions={
        <A href="/api/core/type-aliases/notifyadapter/" class="unstyled text-accent-fg">
          API reference →
        </A>
      }
      proseNames
      items={members()}
    />

    <h2>How adapters behave</h2>
    <ul>
      <li>
        <strong>Notifications are hints.</strong> The system works correctly even if they are lost
        or duplicated; workers fall back to polling.
      </li>
      <li>
        <strong>One notification per item.</strong> <code>notify*</code> methods take a non-empty
        batch of unique items and publish each item as its own notification.
      </li>
      <li>
        <strong>Delivery may be synchronous.</strong> A <code>notify*</code> call may run its
        listeners before it returns.
      </li>
      <li>
        <strong>Listeners are isolated.</strong> A listener that throws does not keep other
        listeners from receiving the notification, and its error does not reach the{" "}
        <code>notify*</code> caller.
      </li>
      <li>
        <strong>Listeners return a dispose function</strong> that unsubscribes.
      </li>
      <li>
        <strong>
          <code>close</code> is idempotent.
        </strong>{" "}
        The second call is a no-op; after close, <code>notify*</code> and <code>listen*</code> calls
        reject, while dispose functions returned before close still work. On shutdown, stop the
        workers, close the notify adapter, close the state adapter, then close the clients and pools
        you own. Holding each with <code>await using</code>, declared in the order they are created,
        closes them in this order.
      </li>
    </ul>
    <p>
      For multi-worker coordination via notifications, see{" "}
      <A href="/guides/horizontal-scaling/">Horizontal Scaling</A>.
    </p>
  </>
);

export default Page;
