export const SCHEMA_VERSION = 2;

export const snapshotStatements: string[] = [
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{prefix}}job (
  id                            {{job_id_type}} NOT NULL,
  chain_id                      {{job_id_type}} NOT NULL,
  chain_index                   INT NOT NULL,
  continued_to_id               {{job_id_type}} NULL,
  type_name                     {{name_type}} NOT NULL,
  status                        VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  chain_status                  VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at                    DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  scheduled_at                  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  completed_at                  DATETIME(6) NULL,
  last_attempt_at               DATETIME(6) NULL,
  attempt_at                    DATETIME(6) NULL,
  chain_completed_at            DATETIME(6) NULL,
  attempt                       INT NOT NULL DEFAULT 0,
  consecutive_failures          INT NOT NULL DEFAULT 0,
  chain_deduplication_key       {{name_type}} NULL,
  chain_trace_context           TEXT NULL,
  trace_context                 TEXT NULL,
  last_attempt_error            LONGTEXT NULL,
  last_reschedule_reason        TEXT NULL,
  input                         JSON NULL,
  output                        JSON NULL,
  attempt_by                    {{worker_id_type}} NULL,
  completed_by                  {{worker_id_type}} NULL,
  attempt_token                 CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status_ts                     DATETIME(6) AS (CASE status WHEN 'running' THEN attempt_at WHEN 'completed' THEN completed_at ELSE scheduled_at END) STORED,
  blocking                      BOOLEAN NOT NULL DEFAULT FALSE,
  blockers_remaining            INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY {{name_prefix}}chain_index_idx (chain_id, chain_index),
  KEY {{name_prefix}}job_status_idx (type_name, status, status_ts),
  KEY {{name_prefix}}job_idx (type_name, created_at),
  KEY {{name_prefix}}chain_idx (type_name, chain_index, created_at),
  KEY {{name_prefix}}chain_running_idx (type_name, chain_status, created_at),
  KEY {{name_prefix}}chain_completed_idx (type_name, chain_status, chain_completed_at),
  KEY {{name_prefix}}chain_deduplication_idx (chain_deduplication_key, type_name, chain_index, created_at),
  KEY {{name_prefix}}job_attempt_by_idx (attempt_by, status, attempt_at),
  KEY {{name_prefix}}chain_blocking_idx (type_name, blocking, chain_index, created_at),
  CONSTRAINT {{name_prefix}}job_status_check CHECK (status IN ('blocked', 'pending', 'running', 'completed')),
  CONSTRAINT {{name_prefix}}job_chain_status_check CHECK (chain_status IN ('running', 'completed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE={{collation}}`,
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{prefix}}job_blocker (
  job_id                        {{job_id_type}} NOT NULL,
  blocked_by_chain_id           {{job_id_type}} NOT NULL,
  \`index\`                       INT NOT NULL,
  trace_context                 TEXT NULL,
  PRIMARY KEY (job_id, blocked_by_chain_id, \`index\`),
  KEY {{name_prefix}}job_blocker_chain_idx (blocked_by_chain_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE={{collation}}`,
  /* sql */ `
CREATE TABLE IF NOT EXISTS {{prefix}}worker (
  id                            {{worker_id_type}} NOT NULL,
  type_names                    JSON NOT NULL,
  concurrency                   INT NOT NULL,
  started_at                    DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  lease_until                   DATETIME(6) NOT NULL,
  token                         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (id),
  KEY {{name_prefix}}worker_idx (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE={{collation}}`,
  /* sql */ `CREATE TABLE IF NOT EXISTS {{prefix}}schema_fence_v${SCHEMA_VERSION} (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`,
];
