import type { FieldItem } from "../../FieldList.tsx";

export const redisRecordKeys = (): FieldItem[] => [
  {
    name: "job:<id>",
    chips: ["hash"],
    description: (
      <>
        One job, the Redis form of a <code>job</code> row with its <code>job_blocker</code> rows.{" "}
        <code>v</code> is the version of its last write, <code>d</code> the JSON fields the Lua
        scripts read and change (ids, type name, status, chain status, attempt fields, timestamps
        and, on a chain's head, <code>blocking</code>, the counterpart of the SQL{" "}
        <code>blocking</code> column), and <code>u</code> the JSON fields no script reads: input,
        output, last attempt error, last reschedule reason, trace contexts, deduplication key,{" "}
        <code>completedBy</code> and blockers. A field that is <code>null</code> is left out of
        both.
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

export const redisIndexKeys = (): FieldItem[] => [
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
    name: "blocking-chains:createdAt:all:<typeName>, blocking-chains:createdAt:<status>:<typeName>",
    chips: ["zset", "chain_blocking_idx"],
    description:
      "Chain heads a job references as a blocker, by creation time, all of them and per status: chain listings filtered to chains that block others.",
  },
  {
    name: "blocking-chains:completedAt:completed:<typeName>",
    chips: ["zset", "chain_blocking_idx"],
    description: "Completed chain heads a job references as a blocker, by completion time.",
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
      "The number of jobs each chain blocks: chain listings of chains that block none, and the 002_schema_v2 backfill.",
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
