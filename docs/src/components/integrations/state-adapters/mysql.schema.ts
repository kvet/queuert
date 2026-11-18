import type { SchemaIndex, SchemaTable } from "./schema-types.ts";

const sameAsId = "same as id";

export const mysqlTables: SchemaTable[] = [
  {
    name: "job",
    purpose: "Stores all job state.",
    columns: [
      {
        name: "id",
        type: "jobIdType (default: CHAR(36))",
        primaryKey: true,
        description: "Job identifier",
      },
      { name: "type_name", type: "VARCHAR(255)", description: "Job type identifier" },
      { name: "chain_id", type: sameAsId, description: "The chain's head job id" },
      {
        name: "chain_index",
        type: "INT",
        description: "Position in chain (0 for the head)",
      },
      { name: "continued_to_id", type: sameAsId, description: "The next job's id in the chain" },
      { name: "input", type: "JSON", description: "Job input data" },
      { name: "output", type: "JSON", description: "Completion output (null until completed)" },
      {
        name: "status",
        type: "VARCHAR(16)",
        description: "blocked, pending, running or completed (CHECK-constrained)",
      },
      { name: "created_at", type: "DATETIME(6)", description: "UTC — when the job was created" },
      {
        name: "scheduled_at",
        type: "DATETIME(6)",
        description: "UTC — earliest time the job can be acquired",
      },
      { name: "completed_at", type: "DATETIME(6)", description: "UTC — when the job completed" },
      { name: "completed_by", type: "same as worker.id", description: "Worker ID" },
      { name: "attempt", type: "INT", description: "Number of processing attempts" },
      {
        name: "last_attempt_at",
        type: "DATETIME(6)",
        description: "UTC — when the last failed attempt ended",
      },
      {
        name: "last_attempt_error",
        type: "JSON",
        description: "Error from the last failed or reclaimed attempt",
      },
      {
        name: "attempt_at",
        type: "DATETIME(6)",
        description: "UTC — when the current attempt started",
      },
      {
        name: "attempt_by",
        type: "same as worker.id",
        description: "Worker ID holding the attempt",
      },
      { name: "attempt_token", type: "CHAR(36)", description: "Token of the current attempt" },
      { name: "trace_context", type: "TEXT", description: "W3C traceparent for this job" },
      {
        name: "status_ts",
        type: "DATETIME(6), generated",
        description:
          "attempt_at while running, completed_at once completed, scheduled_at otherwise; stands in for PostgreSQL's per-status partial indexes",
      },
      {
        name: "chain_status",
        type: "VARCHAR(16)",
        head: true,
        description: "running or completed (CHECK-constrained)",
      },
      {
        name: "chain_completed_at",
        type: "DATETIME(6)",
        head: true,
        description: "UTC — when the chain completed",
      },
      {
        name: "chain_deduplication_key",
        type: "VARCHAR(255)",
        head: true,
        description: "Key for chain deduplication",
      },
      {
        name: "chain_trace_context",
        type: "TEXT",
        head: true,
        description: "W3C traceparent for the chain",
      },
      {
        name: "blocking",
        type: "BOOLEAN",
        head: true,
        description:
          "Whether a job_blocker row references the chain; cleared when the last one is deleted",
      },
    ],
  },
  {
    name: "job_blocker",
    purpose: "Tracks dependencies between jobs and chains. Each blocker slot is unique.",
    columns: [
      { name: "job_id", type: sameAsId, primaryKey: true, description: "The blocked job" },
      {
        name: "blocked_by_chain_id",
        type: sameAsId,
        primaryKey: true,
        description: "Head job ID of the blocker chain",
      },
      {
        name: "index",
        type: "INT",
        primaryKey: true,
        description: "Position in the blockers array",
      },
      { name: "trace_context", type: "TEXT", description: "W3C traceparent" },
    ],
  },
  {
    name: "worker",
    purpose: "Holds one row per worker, each with a lease.",
    columns: [
      { name: "started_at", type: "DATETIME(6)", description: "UTC — when the worker started" },
      {
        name: "lease_until",
        type: "DATETIME(6)",
        description: "UTC — the worker is live while it is in the future",
      },
      {
        name: "token",
        type: "CHAR(36)",
        description: "Identifies this registration, new on every insert",
      },
      { name: "concurrency", type: "INT", description: "Most attempts the worker runs at once" },
      {
        name: "id",
        type: "workerIdType (default: CHAR(36))",
        primaryKey: true,
        description: "Worker ID, the worker runner's workerId",
      },
      { name: "type_names", type: "JSON", description: "Job types the worker processes" },
    ],
  },
  {
    name: "migration",
    purpose: "Tracks applied schema migrations.",
    columns: [
      {
        name: "name",
        type: "VARCHAR(255)",
        description: "Migration identifier (e.g., 001_schema_v1)",
      },
      {
        name: "applied_at",
        type: "DATETIME(6)",
        description: "UTC — when the migration was applied",
      },
    ],
  },
  {
    name: "migration_lock",
    purpose:
      "Holds a single-row lease that gives migrateToLatest() cross-process mutual exclusion.",
    columns: [
      { name: "id", type: "INT", description: "Always 1 (single-row constraint)" },
      {
        name: "locked_by",
        type: "VARCHAR(255)",
        description: "Owner id of the current migration run",
      },
      {
        name: "locked_until",
        type: "DATETIME(6)",
        description: "UTC — lease expiry (heartbeat-extended)",
      },
    ],
  },
  {
    name: "schema_fence_v<N>",
    purpose:
      "Always empty; one per schema version N whose code may write. Every insert or update of a job, blocker or worker references its version's table, and a breaking migration drops the older ones.",
    columns: [{ name: "id", type: "INT", primaryKey: true, description: "Never written" }],
  },
];

export const mysqlIndexes: SchemaIndex[] = [
  {
    name: "chain_index_idx",
    table: "job",
    definition: "UNIQUE (chain_id, chain_index)",
    purpose: "Chain position uniqueness",
  },
  {
    name: "job_status_idx",
    table: "job",
    definition: "(type_name, status, status_ts)",
    purpose: "Job acquisition and job listing by status",
  },
  {
    name: "job_idx",
    table: "job",
    definition: "(type_name, created_at)",
    purpose: "All jobs by type and time",
  },
  {
    name: "chain_idx",
    table: "job",
    definition: "(type_name, chain_index, created_at)",
    purpose: "Chains by type and time",
  },
  {
    name: "chain_running_idx",
    table: "job",
    definition: "(type_name, chain_status, created_at)",
    purpose: "Chain listing and counts by status",
  },
  {
    name: "chain_completed_idx",
    table: "job",
    definition: "(type_name, chain_status, chain_completed_at)",
    purpose: "Completed chain listing",
  },
  {
    name: "chain_blocking_idx",
    table: "job",
    definition: "(type_name, blocking, chain_index, created_at)",
    purpose: "Listing chains that other jobs depend on",
  },
  {
    name: "chain_deduplication_idx",
    table: "job",
    definition: "(chain_deduplication_key, type_name, chain_index, created_at)",
    purpose: "Deduplication lookup",
  },
  {
    name: "job_attempt_by_idx",
    table: "job",
    definition: "(attempt_by, status, attempt_at)",
    purpose: "Worker job listing and running job counts",
  },
  {
    name: "job_blocker_chain_idx",
    table: "job_blocker",
    definition: "(blocked_by_chain_id)",
    purpose: "Blocker resolution",
  },
  {
    name: "worker_idx",
    table: "worker",
    definition: "(started_at)",
    purpose: "Worker listing",
  },
];
