export type SchemaDialect = "postgres" | "sqlite";

export type SchemaColumn = {
  name: string;
  type: string;
  primaryKey?: boolean;
  /** Written on the chain's head row only. */
  head?: boolean;
  description?: string;
};

export type SchemaTable = {
  name: string;
  purpose: string;
  columns: SchemaColumn[];
};

export type SchemaIndex = {
  name: string;
  table: string;
  definition: string;
  purpose: string;
};

const sameAsId = "same as id";

export const schemaTables: Record<SchemaDialect, SchemaTable[]> = {
  postgres: [
    {
      name: "job",
      purpose: "Stores all job state.",
      columns: [
        {
          name: "id",
          type: "jobIdType (default: uuid)",
          primaryKey: true,
          description: "Job identifier",
        },
        { name: "type_name", type: "text", description: "Job type identifier" },
        {
          name: "chain_id",
          type: sameAsId,
          description: "The head job's id — every job in a chain points to the head",
        },
        {
          name: "chain_index",
          type: "integer",
          description: "Position in chain (0 for the head, incrementing for continuations)",
        },
        { name: "continued_to_id", type: sameAsId, description: "The next job's id in the chain" },
        { name: "input", type: "jsonb", description: "Job input data" },
        { name: "output", type: "jsonb", description: "Completion output (null until completed)" },
        {
          name: "status",
          type: "text",
          description: "blocked, pending, running or completed (CHECK-constrained)",
        },
        { name: "created_at", type: "timestamptz", description: "When the job was created" },
        {
          name: "scheduled_at",
          type: "timestamptz",
          description: "Earliest time the job can be acquired",
        },
        {
          name: "completed_at",
          type: "timestamptz",
          description: "When the job completed (null until completed)",
        },
        {
          name: "completed_by",
          type: "same as worker.id",
          description: "Worker ID that completed the job (null for workerless)",
        },
        {
          name: "attempt",
          type: "integer",
          description: "Number of processing attempts (starts at 0)",
        },
        {
          name: "last_attempt_at",
          type: "timestamptz",
          description: "When the last failed attempt ended",
        },
        {
          name: "last_attempt_error",
          type: "jsonb",
          description: "Error from the last failed or reclaimed attempt",
        },
        {
          name: "attempt_at",
          type: "timestamptz",
          description: "When the current attempt started (null when idle)",
        },
        {
          name: "attempt_by",
          type: "same as worker.id",
          description: "Worker ID holding the current attempt",
        },
        { name: "attempt_token", type: "uuid", description: "Token of the current attempt" },
        { name: "trace_context", type: "text", description: "W3C traceparent for this job" },
        {
          name: "chain_status",
          type: "text",
          head: true,
          description: "running or completed (CHECK-constrained)",
        },
        {
          name: "chain_completed_at",
          type: "timestamptz",
          head: true,
          description: "When the chain completed (null until completed)",
        },
        {
          name: "chain_deduplication_key",
          type: "text",
          head: true,
          description: "Key for chain deduplication",
        },
        {
          name: "chain_trace_context",
          type: "text",
          head: true,
          description: "W3C traceparent for the chain",
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
          type: "integer",
          primaryKey: true,
          description: "Position in the blockers array",
        },
        { name: "trace_context", type: "text", description: "W3C traceparent" },
      ],
    },
    {
      name: "worker",
      purpose: "Holds one row per worker, each with a lease.",
      columns: [
        { name: "started_at", type: "timestamptz", description: "When the worker started" },
        {
          name: "lease_until",
          type: "timestamptz",
          description: "Lease expiry — the worker is live while it is in the future",
        },
        {
          name: "token",
          type: "uuid",
          description: "Identifies this registration, new on every insert",
        },
        {
          name: "concurrency",
          type: "integer",
          description: "Most attempts the worker runs at once",
        },
        {
          name: "id",
          type: "workerIdType (default: uuid)",
          primaryKey: true,
          description: "Worker ID, the worker runner's workerId",
        },
        { name: "type_names", type: "text[]", description: "Job types the worker processes" },
      ],
    },
    {
      name: "migration",
      purpose: "Tracks applied schema migrations.",
      columns: [
        {
          name: "name",
          type: "text",
          description: "Migration identifier (e.g., 001_initial_schema)",
        },
        { name: "applied_at", type: "timestamptz", description: "When the migration was applied" },
      ],
    },
    {
      name: "migration_lock",
      purpose:
        "Holds a single-row lease that gives migrateToLatest() cross-process mutual exclusion.",
      columns: [
        { name: "id", type: "integer", description: "Always 1 (single-row constraint)" },
        { name: "locked_by", type: "text", description: "Owner id of the current migration run" },
        {
          name: "locked_until",
          type: "timestamptz",
          description: "Lease expiry (heartbeat-extended)",
        },
      ],
    },
    {
      name: "schema_fence_v<N>",
      purpose:
        "Always empty; one per schema version N whose code may write. Every insert or update of a job, blocker or worker references its version's table, and a breaking migration drops the older ones.",
      columns: [{ name: "id", type: "integer", primaryKey: true, description: "Never written" }],
    },
  ],
  sqlite: [
    {
      name: "migration",
      purpose: "Tracks applied schema migrations.",
      columns: [
        {
          name: "name",
          type: "TEXT",
          description: "Migration identifier (e.g., 001_initial_schema)",
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
        { name: "last_attempt_at", type: "TEXT", description: "ISO 8601 timestamp" },
        { name: "last_attempt_error", type: "TEXT", description: "Error as JSON string" },
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
  ],
};

const jobIndexes = (chainIndexPurpose: string): SchemaIndex[] => [
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
    purpose: chainIndexPurpose,
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

export const schemaIndexes: Record<SchemaDialect, SchemaIndex[]> = {
  postgres: jobIndexes("Chain position uniqueness"),
  sqlite: jobIndexes("Continuation position uniqueness"),
};
