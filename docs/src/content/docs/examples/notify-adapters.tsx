import { ExampleRows } from "../../../components/ExampleList.tsx";

export const meta = {
  title: "Notify Adapters",
  description: "Runnable examples for the Redis, PostgreSQL and NATS notify adapters.",
};

const Page = () => (
  <>
    <p>
      Each example starts its broker in Docker, keeps job state in the in-process state adapter, and
      lets the notify adapter wake the worker as soon as a chain is created. Most implement the
      notify provider for one client in <code>src/provider.ts</code>; the NATS adapter takes the
      connection directly.
    </p>
    <h2 id="redis">Redis</h2>
    <ExampleRows
      title="@queuert/redis"
      names={[
        "notify-redis-ioredis",
        "notify-redis-redis",
        "notify-redis-bun",
        "notify-redis-cluster-ioredis",
        "notify-redis-cluster-node-redis",
      ]}
    />
    <h2 id="postgresql">PostgreSQL LISTEN/NOTIFY</h2>
    <ExampleRows
      title="@queuert/postgres"
      names={["notify-postgres-pg", "notify-postgres-postgres-js", "notify-postgres-bun-sql"]}
    />
    <h2 id="nats">NATS</h2>
    <ExampleRows title="@queuert/nats" names={["notify-nats-nats"]} />
  </>
);

export default Page;
