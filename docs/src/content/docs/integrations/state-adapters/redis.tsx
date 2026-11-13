import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList, type FieldItem } from "../../../../components/FieldList.tsx";
import { ClientTiles } from "../../../../components/integrations/ClientTiles.tsx";
import { ExperimentalAside } from "../../../../components/integrations/ExperimentalAside.tsx";
import {
  StateAdapterConfigNote,
  stateAdapterConfigItems,
} from "../../../../components/integrations/state-adapters/stateAdapterConfig.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";

export const meta = {
  title: "Redis State Adapter",
  description:
    "Keep chains, jobs and workers in Redis or Redis Cluster with ioredis or node-redis, using optimistic transactions.",
};

const options = (): FieldItem[] => [
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
    name: "maxTransactionTries",
    chips: [{ label: "50", mono: true }],
    description: (
      <>
        The most tries of one transaction. After that many conflicting tries,{" "}
        <code>withTransaction</code> throws <code>RedisTransactionConflictError</code>.
      </>
    ),
  },
  ...stateAdapterConfigItems(),
];

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

const recordKeys = (): FieldItem[] => [
  {
    name: "job:<id>",
    chips: ["hash"],
    description: (
      <>
        One job, the Redis form of a <code>job</code> row with its <code>job_blocker</code> rows.{" "}
        <code>v</code> is the version of its last write, <code>d</code> the JSON fields the Lua
        scripts read and change (ids, type name, status, chain status, attempt fields and
        timestamps), and <code>u</code> the JSON fields no script reads: input, output, last attempt
        error, trace contexts, deduplication key, <code>completedBy</code> and blockers. A field
        that is <code>null</code> is left out of both.
      </>
    ),
  },
  {
    name: "worker:<id>",
    chips: ["hash"],
    description: (
      <>
        One worker, the Redis form of a <code>worker</code> row: its job types, concurrency, start
        time, lease and token in <code>d</code>.
      </>
    ),
  },
  {
    name: "deduplication:<[typeName,key]>",
    chips: ["hash"],
    description: (
      <>
        The head ids of the chains created with one deduplication key: the chains still running and
        the newest one. It serves what <code>chain_deduplication_idx</code> serves in PostgreSQL.
      </>
    ),
  },
  {
    name: "sequence",
    chips: ["string"],
    description:
      "The counter every commit and claim increments; its value is the version the write stamps on records and blocker sets.",
  },
  {
    name: "set-versions",
    chips: ["hash"],
    description:
      "The version of the last write that changed each non-empty set the adapter keeps, such as blocked-by:<chainId>, so a transaction that read a set conflicts when it changed.",
  },
  {
    name: "schema-fences",
    chips: ["set"],
    description: (
      <>
        The schema versions whose code may write; see <a href="#write-fence">Write fence</a>.
      </>
    ),
  },
  {
    name: "migrations",
    chips: ["set"],
    description: (
      <>
        The names of the applied schema migrations; see <a href="#migrations">Migrations</a>.
      </>
    ),
  },
  {
    name: "migration-lock",
    chips: ["string"],
    description: "The lease of the process running migrations, expiring on its own.",
  },
  {
    name: "job-lock:<id>",
    chips: ["string"],
    description: "Marks a pending job an exclusive read holds, for up to 60 seconds.",
  },
  {
    name: "commit:<token>, claim:<token>",
    chips: ["string"],
    description:
      "Markers of an applied commit and of the jobs a claim took, kept 60 seconds so a resent script applies once.",
  },
];

const indexKeys = (): FieldItem[] => [
  {
    name: "chain-jobs:<chainId>",
    chips: ["zset", "chain_index_idx"],
    description: "The jobs of a chain scored by chain index: chain listings and the chain's tail.",
  },
  {
    name: "jobs:createdAt:all:<typeName>",
    chips: ["zset", "job_idx"],
    description: "Every job of a type by creation time: job listings without a status filter.",
  },
  {
    name: "jobs:createdAt:<status>:<typeName>",
    chips: ["zset"],
    description:
      "The jobs of a type in one status by creation time: per-status counts and listings.",
  },
  {
    name: "jobs:scheduledAt:pending:<typeName>",
    chips: ["zset", "job_pending_idx"],
    description: "Pending jobs by scheduled time: listings of pending jobs.",
  },
  {
    name: "due:<typeName>",
    chips: ["zset", "job_pending_idx"],
    description:
      "Pending jobs by scheduled time, with the creation order in the member to break ties: the claim scans it for due jobs.",
  },
  {
    name: "jobs:scheduledAt:blocked:<typeName>",
    chips: ["zset", "job_blocked_idx"],
    description: "Blocked jobs by scheduled time: listings of blocked jobs.",
  },
  {
    name: "jobs:attemptAt:running:<typeName>",
    chips: ["zset", "job_running_idx"],
    description: "Running jobs by attempt start: listings of running jobs.",
  },
  {
    name: "jobs:completedAt:completed:<typeName>",
    chips: ["zset", "job_completed_idx"],
    description: "Completed jobs by completion time: listings of completed jobs.",
  },
  {
    name: "running:<workerId>",
    chips: ["zset", "job_attempt_by_idx"],
    description: "The jobs a worker is running, by attempt start: a worker's jobs and their count.",
  },
  {
    name: "job-type-names",
    chips: ["hash"],
    description: "The number of jobs of each type: the job type names in use.",
  },
  {
    name: "chains:createdAt:all:<typeName>",
    chips: ["zset", "chain_idx"],
    description: "Chain heads by creation time: chain listings without a status filter.",
  },
  {
    name: "chains:createdAt:<status>:<typeName>",
    chips: ["zset", "chain_running_idx"],
    description: "Chain heads in one status by creation time: per-status counts and listings.",
  },
  {
    name: "chains:completedAt:completed:<typeName>",
    chips: ["zset", "chain_completed_idx"],
    description: "Completed chain heads by completion time.",
  },
  {
    name: "chain-type-names",
    chips: ["hash"],
    description: "The number of chains of each type: the chain type names in use.",
  },
  {
    name: "blocked-by:<chainId>",
    chips: ["set", "job_blocker_chain_idx"],
    description:
      "The jobs a chain blocks: unblocking them when it completes, and refusing to delete it while they exist.",
  },
  {
    name: "blocked-jobs:<chainId>",
    chips: ["zset", "job_blocker_chain_idx"],
    description: "The jobs a chain blocks by creation time: listings of a chain's blocked jobs.",
  },
  {
    name: "blocker-references",
    chips: ["hash"],
    description:
      "The number of jobs each chain blocks: chain listings filtered by whether a chain blocks others.",
  },
  {
    name: "workers, workers-of-type:<typeName>",
    chips: ["zset", "worker_idx"],
    description: "Workers by start time, all of them and per job type: worker listings.",
  },
  {
    name: "worker-leases, worker-leases-of-type:<typeName>",
    chips: ["zset"],
    description: "Workers by lease end, all of them and per job type: live and expired counts.",
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

    <h2>Clients</h2>
    <ClientTiles
      syncKey="redis-driver"
      anchor="setup"
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

    <h2>Install</h2>
    <Code lang="bash">{`npm install @queuert/redis`}</Code>

    <h2>Setup</h2>
    <p>
      Each tab shows the example's <code>RedisStateProvider</code> and the lines that create the
      adapter and bring its keys to the latest schema with <code>migrateToLatest()</code>:
    </p>
    <Tabs syncKey="redis-driver">
      <TabItem label="node-redis">
        <ExampleCode example="state-redis-redis" file="src/provider.ts" />
        <ExampleCode
          example="state-redis-redis"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="ioredis">
        <ExampleCode example="state-redis-ioredis" file="src/provider.ts" />
        <ExampleCode
          example="state-redis-ioredis"
          file="src/index.ts"
          region="adapter"
          title="src/index.ts"
        />
      </TabItem>
    </Tabs>

    <h2>Configuration</h2>
    <FieldList title="createRedisStateAdapter" idPrefix="option" items={options()} />
    <StateAdapterConfigNote />

    <h2>State provider</h2>
    <p>
      A <code>RedisStateProvider</code> is one method over any Redis client: the adapter reads and
      writes only through Lua scripts. Each Setup tab is a complete provider:
    </p>
    <FieldList title="RedisStateProvider" idPrefix="provider" items={providerMembers()} />

    <h2>Transactions</h2>
    <p>
      <code>withTransaction</code> reads from Redis and records the version of every record it
      reads, buffers every write, and commits with one Lua script that applies the writes only if
      none of those versions changed. When one did, the adapter runs the callback again with fresh
      reads. A callback that throws after reading records another transaction has since changed runs
      again too. After <code>maxTransactionTries</code> conflicting tries it throws{" "}
      <code>RedisTransactionConflictError</code>, with the last callback's error as its{" "}
      <code>cause</code> when that try threw.
    </p>
    <ul>
      <li>
        <strong>Callbacks may run more than once.</strong> Keep side effects out of the callback and
        register them with <code>onTransactionCommit</code>, which runs once, after the commit.
      </li>
      <li>
        <strong>Pass the adapter's context.</strong> Create chains and complete jobs with the
        context <code>withTransaction</code> passes to its callback. The adapter's transactions
        carry their own commit and rollback callbacks, so they need no <code>withTxHooks</code>.
      </li>
      <li>
        <strong>A resent commit applies once.</strong> A commit leaves a marker in{" "}
        <code>{"{keyPrefix}"}commit:*</code> and a claim of job attempts leaves the jobs it claimed
        in <code>{"{keyPrefix}"}claim:*</code>, both for 60 seconds. A client that resends a script
        after a reconnect, as ioredis does by default, gets the first reply back instead of applying
        it twice.
      </li>
      <li>
        <strong>No other database joins the transaction.</strong> A write to your application
        database cannot commit or roll back together with Queuert's state in Redis.
      </li>
    </ul>
    <Tabs syncKey="redis-driver">
      <TabItem label="node-redis">
        <ExampleCode
          example="state-redis-redis"
          file="src/index.ts"
          region="transaction"
          title="src/index.ts"
        />
      </TabItem>
      <TabItem label="ioredis">
        <ExampleCode
          example="state-redis-ioredis"
          file="src/index.ts"
          region="transaction"
          title="src/index.ts"
        />
      </TabItem>
    </Tabs>

    <h2>With an application database</h2>
    <p>
      Because no other database joins its transactions, the adapter fits work that starts from a
      committed fact in your application database. Run a PostgreSQL or SQLite Queuert as a
      transactional outbox: create its chain in the same transaction as your application write, and
      let its handler start the chain in the Redis Queuert. Give that chain a{" "}
      <A href="/guides/deduplication/">deduplication</A> key derived from the outbox job, so a
      handler that runs again after a failure returns the chain it already started instead of
      creating a second one.
    </p>

    <h2>Locks</h2>
    <p>
      A read with <code>lock: "exclusive"</code> of a pending job, such as the one{" "}
      <code>completeChain</code> takes, marks the job for up to 60 seconds; workers skip a marked
      job until the transaction commits or rolls back. A <code>completeChain</code> handler that
      runs longer than that can see a worker claim the job. Workers look past marked jobs through at
      most the first 1,000 due jobs of each type, so a worker claims nothing of a type whose first
      1,000 due jobs are all marked.
    </p>
    <p>
      No transaction ever waits for a lock. Where PostgreSQL would make a second transaction wait
      for the first, the Redis adapter lets both run and the one that commits second runs again. In
      the conformance cases that check a wait, each outcome matches some order of the two
      transactions; those cases are left out of the suite and listed in{" "}
      <code>redisStateAdapterLockWaitCaseNames</code>.
    </p>

    <h2 id="migrations">Migrations</h2>
    <p>
      <code>migrateToLatest()</code> applies the adapter's schema migrations and records each one in
      the <code>{"{keyPrefix}"}migrations</code> set. Run it on every boot: processes that run it at
      once take turns through a lease in <code>{"{keyPrefix}"}migration-lock</code>, so one migrates
      and the others wait and then find nothing left to do.
    </p>

    <h2 id="write-fence">Write fence</h2>
    <p>
      The set <code>{"{keyPrefix}"}schema-fences</code> holds the schema versions whose code may
      write. The commit script of every transaction that creates, continues, completes, reschedules,
      blocks or unblocks jobs, or starts a worker or extends its lease, checks that the set holds
      the adapter's version before it writes anything, and so does the script that starts job
      attempts. Without it the script writes nothing and the adapter throws{" "}
      <code>SchemaFencedError</code>. Until <code>migrateToLatest()</code> has run, the set is empty
      and every such write is fenced. A breaking migration removes the versions of older code, so
      older processes fail those writes instead of corrupting state. Reads,{" "}
      <code>deleteChains</code> and <code>stopWorker</code> still work, and older workers report the
      error through <code>workerError</code> and keep retrying. Stop them once you have deployed the
      newer version.
    </p>
    <p>
      The check runs when the transaction commits, so a transaction that began before a breaking
      migration and commits after it is fenced too, whatever it wrote before the migration.
    </p>

    <h2 id="schema">Schema</h2>
    <p>
      Every key starts with <code>keyPrefix</code>, left out below. Records hold the state, and
      every other key is an index the adapter derives from them, so the layout reads like the{" "}
      <A href="/integrations/state-adapters/postgres/#schema">PostgreSQL schema</A>: a{" "}
      <code>job</code> record per job, a <code>worker</code> record per worker, and an index per
      PostgreSQL index, named after it where one matches. The adapter's job lock, commit and claim
      markers expire on their own.
    </p>
    <FieldList title="records" items={recordKeys()} />

    <h2 id="indexes">Indexes</h2>
    <p>
      Every write of a record updates its index entries in the same script, and so does the claim of
      job attempts. A job sits in an index while it matches the index's condition, such as{" "}
      <code>status = 'pending'</code> for <code>due:</code>, with the job id as the member and the
      named timestamp as the score. The hashes count records per type name or blocker chain, and a
      field goes away when its count reaches zero.
    </p>
    <FieldList title="indexes" items={indexKeys()} />

    <h2 id="schema-changes">Schema changes</h2>
    <p>
      A schema change ships as a numbered migration that <code>migrateToLatest()</code> applies. A
      change to an index definition ships with a migration that rebuilds the indexes: it drops every
      index key and computes them again from the job and worker records, in batches that each block
      Redis briefly. A breaking change also replaces the version in <code>schema-fences</code>, so
      older processes stop writing while it runs.
    </p>

    <h2 id="redis-configuration">Redis configuration</h2>
    <p>Redis is the only copy of Queuert's state, so configure it as a database, not a cache:</p>
    <ul>
      <li>
        <strong>Persistence.</strong> Turn on AOF (<code>appendonly yes</code>); without it a
        restart loses every chain, job and worker written since the last snapshot.
      </li>
      <li>
        <strong>No eviction.</strong> Set <code>maxmemory-policy noeviction</code>, so a full Redis
        rejects writes instead of deleting job records or the expiring lock keys.
      </li>
      <li>
        <strong>Memory.</strong> Every job stays in memory until its chain is deleted, which a{" "}
        <A href="/guides/cleanup/">cleanup</A> job does on a schedule. A job takes about 1.5 KB with
        its index entries, plus its input, output and blockers, so set <code>maxmemory</code> for
        the number of jobs you keep, not for the queue length.
      </li>
    </ul>

    <h2 id="redis-cluster">Redis Cluster</h2>
    <p>
      Every key starts with <code>keyPrefix</code>, whose hash tag sends all of them to one slot, so
      each script runs on one node. A cluster gives that Queuert availability, not more throughput:
      one node holds all of its state. Adapters with different hash tags can land on different
      nodes. Replication to replicas is asynchronous, so a failover can lose the last writes the
      primary acknowledged.
    </p>

    <h2 id="testing-your-provider">Testing your provider</h2>
    <p>
      <code>@queuert/redis/conformance</code> checks a provider you write.{" "}
      <code>redisStateProviderConformanceCases</code> are checks of the <code>eval</code> contract
      followed by every state adapter case the Redis adapter meets, including checks of its write
      fence. <code>createRedisStateProviderConformanceContext</code> takes a{" "}
      <code>createStateProvider</code> factory; each case builds its own adapter over a new provider
      under a key prefix of its own, migrates it, and closes it when it ends. The suite drives no
      test runner: your test file owns the client in its own hooks and registers one test per case:
    </p>
    <Tabs syncKey="redis-driver">
      <TabItem label="node-redis">
        <ExampleCode
          example="state-redis-redis"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
      <TabItem label="ioredis">
        <ExampleCode
          example="state-redis-ioredis"
          file="src/provider.spec.ts"
          region="conformance"
          title="src/provider.spec.ts"
        />
      </TabItem>
    </Tabs>
    <p>
      The full API is in the <A href="/api/redis-conformance/readme/">conformance reference</A>.
    </p>

    <h2>Examples</h2>
    <ExampleRows title="@queuert/redis" names={["state-redis-redis", "state-redis-ioredis"]} />
    <p>
      The API reference for every export is in <A href="/api/redis/readme/">@queuert/redis</A>.
    </p>
  </>
);

export default Page;
