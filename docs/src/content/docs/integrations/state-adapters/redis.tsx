import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { AtAGlance } from "../../../../components/integrations/AtAGlance.tsx";
import { CappedCode } from "../../../../components/integrations/CappedCode.tsx";
import { ClientTiles } from "../../../../components/integrations/ClientTiles.tsx";
import { ExperimentalAside } from "../../../../components/integrations/ExperimentalAside.tsx";
import { FoldGroup } from "../../../../components/integrations/FoldGroup.tsx";
import { RunOnYourMachine } from "../../../../components/integrations/RunOnYourMachine.tsx";
import {
  redisIndexKeys,
  redisRecordKeys,
} from "../../../../components/integrations/state-adapters/redis.schema.tsx";
import {
  StateAdapterConfigNote,
  stateAdapterConfigItems,
} from "../../../../components/integrations/state-adapters/stateAdapterConfig.tsx";
import { Details } from "../../../../components/mdx/Details.tsx";
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";
import { siteHref } from "../../../../docs/href.ts";

export const meta = {
  title: "Redis state adapter",
  description:
    "Keep chains, jobs and workers in Redis or Redis Cluster with ioredis or node-redis, using optimistic transactions.",
};

const mainOptions = (): FieldItem[] => [
  {
    name: "stateProvider",
    chips: ["required"],
    description: (
      <>
        The <code>RedisStateProvider</code> for your client; see{" "}
        <a href="#state-provider">State provider</a>.
      </>
    ),
  },
  {
    name: "keyPrefix",
    chips: [{ label: '"{queuert}:"', mono: true }],
    description: (
      <>
        Prefix of every key the adapter writes. It must contain a non-empty hash tag such as{" "}
        <code>{"{queuert}"}</code>, or the factory throws; see{" "}
        <a href="#redis-cluster">Redis Cluster</a>.
      </>
    ),
  },
  {
    name: "transactionRetry",
    chips: [
      { label: "{ maxTries: 50, initialDelayMs: 2, multiplier: 2, maxDelayMs: 50 }", mono: true },
    ],
    description: (
      <>
        Retries of a transaction that conflicted with concurrent commits: each retry waits a random
        delay up to the backoff of the failed try. After <code>maxTries</code> conflicting tries,{" "}
        <code>withTransaction</code> throws <code>RedisTransactionConflictError</code>.
      </>
    ),
  },
];

const moreOptions = (): FieldItem[] => [...stateAdapterConfigItems()];

const providerMembers = (): FieldItem[] => [
  {
    name: "eval",
    chips: ["required"],
    description: (
      <>
        Runs a Lua script with the given keys and arguments and returns its reply. Every key shares
        the adapter's hash tag, so on a cluster the script runs on one node. The examples cache each
        script's SHA-1 and send <code>EVALSHA</code>, falling back to <code>EVAL</code> when Redis
        answers <code>NOSCRIPT</code>.
      </>
    ),
  },
  {
    name: "close",
    description: (
      <>
        Releases resources the provider owns. Leave it out when the provider wraps a client you
        close yourself; when present, it must be idempotent.
      </>
    ),
  },
];

const Page = () => (
  <>
    <p>
      The Redis state adapter in <code>@queuert/redis</code> keeps Queuert's chains, jobs and
      workers in Redis or Redis Cluster. Redis holds no other data of your application, and it has
      no interactive transactions, so the adapter's transactions are optimistic: they never wait for
      each other, and a transaction that conflicts runs again.
    </p>
    <ExperimentalAside package="@queuert/redis" subject="The Redis state adapter" />

    <AtAGlance
      package="@queuert/redis"
      clients="node-redis, ioredis"
      isolation={
        <>
          Optimistic transactions that never wait: a conflicting transaction runs again; see{" "}
          <a href="#transactions">Transactions</a>
        </>
      }
      pairsWith={[
        { label: "Redis notify adapter", href: "/integrations/notify-adapters/redis/" },
        { label: "NATS notify adapter", href: "/integrations/notify-adapters/nats/" },
      ]}
    />

    <h2>Quick start</h2>
    <ClientTiles
      adapterPackage="@queuert/redis"
      syncKey="redis-driver"
      anchor="quick-start"
      groups={[
        {
          label: "Clients",
          items: [
            { name: "node-redis", tab: "node-redis", packages: "redis" },
            { name: "ioredis", tab: "ioredis", packages: "ioredis" },
          ],
        },
      ]}
    />

    <p>Requires Redis 6 or later, standalone or Redis Cluster.</p>

    <p>
      Pick a client to see its <code>RedisStateProvider</code> and the lines that create the adapter
      and bring its keys to the latest schema with <code>migrateToLatest()</code>:
    </p>
    <Tabs syncKey="redis-driver" pickedElsewhere>
      <TabItem label="node-redis">
        <CappedCode>
          <ExampleCode example="redis/state-redis" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="redis/state-redis"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="ioredis">
        <CappedCode>
          <ExampleCode example="redis/state-ioredis" file="src/provider.ts" />
        </CappedCode>
        <ExampleCode
          example="redis/state-ioredis"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
    </Tabs>

    <h2>Run on your machine</h2>
    <RunOnYourMachine example="redis/state-redis" needs="a Redis server" />

    <h2>Configure</h2>
    <FieldList title="createRedisStateAdapter" idPrefix="option" items={mainOptions()} />
    <Details summary="More options" hint={`${moreOptions().length} options`}>
      <FieldList title="More options" idPrefix="option" items={moreOptions()} />
      <StateAdapterConfigNote />
    </Details>

    <h2>Reference</h2>
    <FoldGroup>
      <Details
        summary={<span id="state-provider">State provider</span>}
        hint={`${providerMembers().length} members`}
      >
        <p>
          A <code>RedisStateProvider</code> is one method over any Redis client: the adapter reads
          and writes only through Lua scripts. Each Quick start tab is a complete provider:
        </p>
        <FieldList title="RedisStateProvider" idPrefix="provider" items={providerMembers()} />
      </Details>
      <Details summary={<span id="transactions">Transactions</span>}>
        <p>
          <code>withTransaction</code> reads from Redis and records the version of every record it
          reads, buffers every write, and commits with one Lua script that applies the writes only
          if none of those versions changed. When one did, the adapter runs the callback again with
          fresh reads. A callback that throws after reading records another transaction has since
          changed runs again too. After <code>transactionRetry.maxTries</code> conflicting tries it
          throws <code>RedisTransactionConflictError</code>, with the last callback's error as its{" "}
          <code>cause</code> when that try threw.
        </p>
        <ul>
          <li>
            <strong>Callbacks may run more than once.</strong> Keep side effects out of the callback
            and register them with <code>onTransactionCommit</code>, which runs once, after the
            commit.
          </li>
          <li>
            <strong>Pass the adapter's context.</strong> Create chains and complete jobs with the
            context <code>withTransaction</code> passes to its callback. The adapter's transactions
            carry their own commit and rollback callbacks, so they need no <code>withTxHooks</code>.
          </li>
          <li>
            <strong>A resent commit applies once.</strong> A commit leaves a marker in{" "}
            <code>{"{keyPrefix}"}commit:*</code> and a claim of job attempts leaves the jobs it
            claimed in <code>{"{keyPrefix}"}claim:*</code>, both for 60 seconds. A client that
            resends a script after a reconnect, as ioredis does by default, gets the first reply
            back instead of applying it twice.
          </li>
          <li>
            <strong>No other database joins the transaction.</strong> A write to your application
            database cannot commit or roll back together with Queuert's state in Redis.
          </li>
        </ul>
        <Tabs syncKey="redis-driver">
          <TabItem label="node-redis">
            <ExampleCode
              example="redis/state-redis"
              file="src/index.ts"
              region="transaction"
              title="src/index.ts"
            />
          </TabItem>
          <TabItem label="ioredis">
            <ExampleCode
              example="redis/state-ioredis"
              file="src/index.ts"
              region="transaction"
              title="src/index.ts"
            />
          </TabItem>
        </Tabs>
      </Details>
      <Details
        summary={<span id="with-an-application-database">With an application database</span>}
      >
        <p>
          Because no other database joins its transactions, the adapter fits work that starts from a
          committed fact in your application database. Run a PostgreSQL or SQLite Queuert as a
          transactional outbox: create its chain in the same transaction as your application write,
          and let its handler start the chain in the Redis Queuert. Give that chain a{" "}
          <a href={siteHref("/guides/deduplication/")}>deduplication</a> key derived from the outbox
          job, so a handler that runs again after a failure returns the chain it already started
          instead of creating a second one.
        </p>
      </Details>
      <Details summary={<span id="locks">Locks</span>}>
        <p>
          A locked read of a pending job, such as a client read with <code>lock: "exclusive"</code>{" "}
          or the one <code>client.applyJobOutcome</code> takes, marks the job for up to 60 seconds;
          workers skip a marked job until the transaction commits or rolls back. A transaction that
          holds the lock longer than that can see a worker claim the job. Workers look past marked
          jobs through at most the first 1,000 due jobs of each type, so a worker claims nothing of
          a type whose first 1,000 due jobs are all marked.
        </p>
        <p>
          No transaction ever waits for a lock. Where PostgreSQL would make a second transaction
          wait for the first, the Redis adapter lets both run and the one that commits second runs
          again. In the conformance cases that check a wait, each outcome matches some order of the
          two transactions; those cases are left out of the suite.
        </p>
      </Details>
      <Details summary={<span id="migrations">Migrations</span>}>
        <p>
          <code>migrateToLatest()</code> applies the adapter's schema migrations and records each
          one in the <code>{"{keyPrefix}"}migrations</code> set. Run it on every boot: processes
          that run it at once take turns through a lease in{" "}
          <code>{"{keyPrefix}"}migration-lock</code>, so one migrates and the others wait and then
          find nothing left to do.
        </p>
      </Details>
      <Details summary={<span id="write-fence">Write fence</span>}>
        <p>
          The set <code>{"{keyPrefix}"}schema-fences</code> holds the schema versions whose code may
          write. The commit script of every transaction that creates, continues, completes,
          reschedules, blocks, unblocks or deletes jobs, or starts, stops or extends the lease of a
          worker, checks that the set holds the adapter's version before it writes anything, and so
          does the script that starts job attempts. Without it the script writes nothing and the
          adapter throws <code>SchemaFencedError</code>. Until <code>migrateToLatest()</code> has
          run, the set is empty and every such write is fenced. A breaking migration removes the
          versions of older code, so older processes fail those writes instead of corrupting state.
          Reads still work, and older workers report the error through <code>workerError</code> and
          keep retrying. Stop them once you have deployed the newer version.
        </p>
        <p>
          The check runs when the transaction commits, so a transaction that began before a breaking
          migration and commits after it is fenced too, whatever it wrote before the migration.
        </p>
      </Details>
      <Details
        summary={<span id="schema">Schema</span>}
        hint={`${redisRecordKeys().length} record keys`}
      >
        <p>
          Every key starts with <code>keyPrefix</code>, left out below. Records hold the state, and
          every other key is an index the adapter derives from them, so the layout reads like the{" "}
          <a href={siteHref("/integrations/state-adapters/postgres/#schema")}>PostgreSQL schema</a>:
          a <code>job</code> record per job, a <code>worker</code> record per worker, and an index
          per PostgreSQL index, named after it where one matches. The adapter's job lock, commit and
          claim markers expire on their own.
        </p>
        <FieldList title="records" items={redisRecordKeys()} />
      </Details>
      <Details
        summary={<span id="indexes">Indexes</span>}
        hint={`${redisIndexKeys().length} index keys`}
      >
        <p>
          Every write of a record updates its index entries in the same script, and so does the
          claim of job attempts. A job sits in an index while it matches the index's condition, such
          as <code>status = 'pending'</code> for <code>due:</code>, with the job id as the member
          and the named timestamp as the score. The hashes count records per type name or blocker
          chain, and a field goes away when its count reaches zero.
        </p>
        <FieldList title="indexes" items={redisIndexKeys()} />
      </Details>
      <Details summary={<span id="schema-changes">Schema changes</span>}>
        <p>
          A schema change ships as a numbered migration that <code>migrateToLatest()</code> applies.
          A breaking change removes the old version from <code>schema-fences</code> before it
          touches any record and adds its own when it finishes, so no process writes while it runs.{" "}
          <code>002_schema_v2</code> sets <code>blocking</code> on the head records that{" "}
          <code>blocker-references</code> names and adds them to the <code>blocking-chains:*</code>{" "}
          indexes, and adds <code>consecutiveFailures</code> to every job record, 1 for a job that
          holds a <code>lastAttemptError</code> and 0 otherwise, in batches of 500 that each block
          Redis briefly.
        </p>
      </Details>
      <Details summary={<span id="redis-configuration">Redis configuration</span>}>
        <p>
          Redis is the only copy of Queuert's state, so configure it as a database, not a cache:
        </p>
        <ul>
          <li>
            <strong>Persistence.</strong> Turn on AOF (<code>appendonly yes</code>); without it a
            restart loses every chain, job and worker written since the last snapshot.
          </li>
          <li>
            <strong>No eviction.</strong> Set <code>maxmemory-policy noeviction</code>, so a full
            Redis rejects writes instead of deleting job records or the expiring lock keys.
          </li>
          <li>
            <strong>Memory.</strong> Every job stays in memory until its chain is deleted, which a{" "}
            <a href={siteHref("/guides/cleanup/")}>cleanup</a> job does on a schedule. A job takes
            about 1.5 KB with its index entries, plus its input, output and blockers, so set{" "}
            <code>maxmemory</code> for the number of jobs you keep, not for the queue length.
          </li>
        </ul>
      </Details>
      <Details summary={<span id="redis-cluster">Redis Cluster</span>}>
        <p>
          Every key starts with <code>keyPrefix</code>, whose hash tag sends all of them to one
          slot, so each script runs on one node. A cluster gives that Queuert availability, not more
          throughput: one node holds all of its state. Adapters with different hash tags can land on
          different nodes. Replication to replicas is asynchronous, so a failover can lose the last
          writes the primary acknowledged.
        </p>
      </Details>
      <Details summary={<span id="testing-your-provider">Testing your provider</span>}>
        <p>
          <code>@queuert/redis/conformance</code> checks a provider you write.{" "}
          <code>createRedisStateProviderConformanceCases</code> returns the cases, ready to run:
          checks of the <code>eval</code> contract followed by every state adapter case the Redis
          adapter meets, including checks of its write fence. It takes a{" "}
          <code>createStateProvider</code> factory; each case builds its own adapter over a new
          provider under a key prefix of its own, migrates it, and closes it when it ends. The suite
          drives no test runner: your test file owns the client in its own hooks and registers one
          test per case:
        </p>
        <Tabs syncKey="redis-driver">
          <TabItem label="node-redis">
            <ExampleCode
              example="redis/state-redis"
              file="src/provider.spec.ts"
              region="conformance"
              title="src/provider.spec.ts"
            />
          </TabItem>
          <TabItem label="ioredis">
            <ExampleCode
              example="redis/state-ioredis"
              file="src/provider.spec.ts"
              region="conformance"
              title="src/provider.spec.ts"
            />
          </TabItem>
        </Tabs>
        <p>
          The full API is in the{" "}
          <a href={siteHref("/api/redis-conformance/readme/")}>conformance reference</a>.
        </p>
      </Details>
    </FoldGroup>

    <h2>Examples</h2>
    <ExampleRows
      commandsShownFor="redis/state-redis"
      page="/integrations/state-adapters/redis/"
      title="@queuert/redis"
      names={["redis/state-redis", "redis/state-ioredis", "redis/multi-worker"]}
    />
    <p>
      The API reference for every export is in{" "}
      <a href={siteHref("/api/redis/readme/")}>@queuert/redis</a>.
    </p>
  </>
);

export default Page;
