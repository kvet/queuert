import type { SchemaIndex, SchemaTable } from "./schema-types.ts";

const sameAsId = "same as id";

export const sqliteTables: SchemaTable[] = [
  {
    name: "migration",
    purpose: "Tracks applied schema migrations.",
    columns: [
      {
        name: "name",
        type: "TEXT",
        description: "Migration identifier (e.g., 001_schema_v1)",
      },
      {
        name: "applied_at",
        type: "TEXT",
        description: "ISO 8601 timestamp — when the migration was applied",
      },
    ],
  },
  {
    name: "job",
    purpose: "Stores all job state.",
    columns: [
      {
        name: "id",
        type: "jobIdType (default: TEXT)",
        primaryKey: true,
        description: "Job identifier",
      },
      {
        name: "type_name",
        type: "TEXT",
        description: "Job type identifier — on a head row, also the chain's type",
      },
      { name: "chain_id", type: sameAsId, description: "The chain's head job id" },
      {
        name: "chain_index",
        type: "INTEGER",
        description: "Position in chain (0 for the head)",
      },
      { name: "continued_to_id", type: sameAsId, description: "The next job's id in the chain" },
      { name: "input", type: "TEXT", description: "Job input as JSON string" },
      { name: "output", type: "TEXT", description: "Completion output as JSON string" },
      {
        name: "status",
        type: "TEXT",
        description: "blocked, pending, running or completed (CHECK-constrained)",
      },
      { name: "created_at", type: "TEXT", description: "ISO 8601 timestamp" },
      { name: "scheduled_at", type: "TEXT", description: "ISO 8601 timestamp" },
      { name: "completed_at", type: "TEXT", description: "ISO 8601 timestamp" },
      { name: "completed_by", type: "TEXT", description: "Worker ID" },
      { name: "attempt", type: "INTEGER", description: "Attempt count" },
      {
        name: "consecutive_failures",
        type: "INTEGER",
        description:
          "Attempts in a row that failed or were reclaimed; 0 after any other outcome or a client reschedule",
      },
      { name: "last_attempt_at", type: "TEXT", description: "ISO 8601 timestamp" },
      {
        name: "last_attempt_error",
        type: "TEXT",
        description: "Serialized error of the last attempt when it failed or was reclaimed",
      },
      {
        name: "last_reschedule_reason",
        type: "TEXT",
        description: "Reason a handler or client gave for the last reschedule",
      },
      {
        name: "attempt_at",
        type: "TEXT",
        description: "ISO 8601 timestamp — set when a worker starts an attempt",
      },
      { name: "attempt_by", type: "TEXT", description: "Worker ID holding the attempt" },
      { name: "attempt_token", type: "TEXT", description: "Token of the current attempt" },
      { name: "trace_context", type: "TEXT", description: "W3C traceparent" },
      {
        name: "chain_status",
        type: "TEXT",
        head: true,
        description: "running or completed (CHECK-constrained)",
      },
      {
        name: "chain_completed_at",
        type: "TEXT",
        head: true,
        description: "ISO 8601 timestamp — the chain's completion",
      },
      {
        name: "chain_deduplication_key",
        type: "TEXT",
        head: true,
        description: "Deduplication key",
      },
      {
        name: "chain_trace_context",
        type: "TEXT",
        head: true,
        description: "W3C traceparent for the chain",
      },
      {
        name: "blocking",
        type: "INTEGER",
        head: true,
        description:
          "Whether a job_blocker row references the chain; cleared when the last one is deleted",
      },
    ],
  },
  {
    name: "job_blocker",
    purpose: "Tracks dependencies between jobs and chains.",
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
        type: "INTEGER",
        primaryKey: true,
        description: "Position in blockers array",
      },
      { name: "trace_context", type: "TEXT", description: "W3C traceparent" },
    ],
  },
  {
    name: "worker",
    purpose: "Holds one row per worker, each with a lease.",
    columns: [
      {
        name: "started_at",
        type: "TEXT",
        description: "ISO 8601 timestamp — when the worker started",
      },
      {
        name: "lease_until",
        type: "TEXT",
        description: "ISO 8601 timestamp — the worker is live while it is in the future",
      },
      {
        name: "token",
        type: "TEXT",
        description: "Identifies this registration, new on every insert",
      },
      {
        name: "concurrency",
        type: "INTEGER",
        description: "Most attempts the worker runs at once",
      },
      {
        name: "id",
        type: "workerIdType (default: TEXT)",
        primaryKey: true,
        description: "Worker ID, the worker runner's workerId",
      },
      {
        name: "type_names",
        type: "TEXT",
        description: "JSON array of the job types the worker processes",
      },
    ],
  },
  {
    name: "write_lock",
    purpose:
      "Always empty; a no-op write to it takes SQLite's write lock at the start of every migration transaction and before every read that locks chains, jobs or workers.",
    columns: [{ name: "id", type: "INTEGER", primaryKey: true, description: "Never written" }],
  },
  {
    name: "schema_fence_v<N>",
    purpose:
      "Always empty; one per schema version N whose code may write. Every insert or update of a job, blocker or worker references its version's table, and a breaking migration drops the older ones.",
    columns: [{ name: "id", type: "INTEGER", primaryKey: true, description: "Never written" }],
  },
];

export const sqliteIndexes: SchemaIndex[] = [
  {
    name: "chain_deduplication_idx",
    table: "job",
    definition:
      "(chain_deduplication_key, created_at DESC) WHERE chain_deduplication_key IS NOT NULL AND chain_index = 0",
    purpose: "Deduplication lookup",
  },
  {
    name: "chain_index_idx",
    table: "job",
    definition: "UNIQUE (chain_id, chain_index) WHERE chain_index > 0",
    purpose: "Continuation position uniqueness",
  },
  {
    name: "job_idx",
    table: "job",
    definition: "(type_name, created_at)",
    purpose: "All jobs by type and time",
  },
  {
    name: "job_pending_idx",
    table: "job",
    definition: "(type_name, scheduled_at) WHERE status = 'pending'",
    purpose: "Job acquisition and pending job listing",
  },
  {
    name: "job_blocked_idx",
    table: "job",
    definition: "(type_name, scheduled_at) WHERE status = 'blocked'",
    purpose: "Blocked job listing",
  },
  {
    name: "job_running_idx",
    table: "job",
    definition: "(type_name, attempt_at) WHERE status = 'running'",
    purpose: "Running job listing",
  },
  {
    name: "job_attempt_by_idx",
    table: "job",
    definition: "(attempt_by, attempt_at) WHERE status = 'running'",
    purpose: "Worker job listing and running job counts",
  },
  {
    name: "job_completed_idx",
    table: "job",
    definition: "(type_name, completed_at) WHERE status = 'completed'",
    purpose: "Completed job listing",
  },
  {
    name: "chain_idx",
    table: "job",
    definition: "(type_name, created_at) WHERE chain_index = 0",
    purpose: "Chains by type and time",
  },
  {
    name: "chain_running_idx",
    table: "job",
    definition: "(type_name, created_at) WHERE chain_index = 0 AND chain_status = 'running'",
    purpose: "Running chain listing",
  },
  {
    name: "chain_completed_idx",
    table: "job",
    definition:
      "(type_name, chain_completed_at) WHERE chain_index = 0 AND chain_status = 'completed'",
    purpose: "Completed chain listing",
  },
  {
    name: "chain_blocking_idx",
    table: "job",
    definition: "(type_name, created_at) WHERE chain_index = 0 AND blocking = 1",
    purpose: "Listing chains that other jobs depend on",
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
