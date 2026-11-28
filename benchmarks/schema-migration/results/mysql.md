# Schema migration 002_schema_v2 on MySQL

mysql:26, mysql2

```text
  scale 1: 14,192 jobs, 6,932 blocker rows, generated as schema v1 in 0.09s
  Scale 1: loaded as schema v1 in 0.50s
    migrateToLatest 0.18s: 0.07s before the fence, 0.11s after
    invariants: 13 checks, 0 violated
    read back 14192 seeded jobs: 359363 values compared, 0 violated
    fence: 2 checks, 0 violated
  Scale 1, schema v1 writers: loaded as schema v1 in 0.47s
    migrateToLatest 0.38s: 0.15s before the fence, 0.23s after
           99.9ms  CREATE INDEX queuert_chain_blocking_idx ON queuert_job (type_name, blocking, chain_index, created_at)
           69.9ms  UPDATE queuert_job h SET h.blocking = TRUE WHERE h.chain_index = 0 AND h.blocking = FALSE AND h.id IN (SELECT
           98.5ms  UPDATE queuert_job j LEFT JOIN ( SELECT jb.job_id, COUNT(*) AS remaining FROM queuert_job_blocker jb LEFT JOIN
    schema v1 writes: before 1892 ops/s (p99 9.0ms), until the fence 1402 ops/s (p99 12.4ms), longest stall 15.5ms, 9684 committed, 28 fenced, 0 other errors
    invariants: 13 checks, 0 violated
    read back 14192 seeded jobs: 359363 values compared, 0 violated
    read back 13693 jobs schema v1 writers wrote: 109544 values compared, 0 violated
    fence: 2 checks, 0 violated

  scale 10: 139,746 jobs, 69,357 blocker rows, generated as schema v1 in 0.68s
  Scale 10: loaded as schema v1 in 4.85s
    migrateToLatest 1.28s: 0.30s before the fence, 0.98s after
          263.5ms  CREATE INDEX queuert_chain_blocking_idx ON queuert_job (type_name, blocking, chain_index, created_at)
          200.1ms  UPDATE queuert_job h SET h.blocking = TRUE WHERE h.chain_index = 0 AND h.blocking = FALSE AND h.id IN (SELECT
          552.2ms  UPDATE queuert_job j LEFT JOIN ( SELECT jb.job_id, COUNT(*) AS remaining FROM queuert_job_blocker jb LEFT JOIN
           60.3ms  UPDATE queuert_job j SET j.status = 'pending', j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)) WHE
           56.2ms  UPDATE queuert_job j SET j.status = 'pending', j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)), j.
           85.3ms  UPDATE queuert_job SET last_attempt_error_text = JSON_UNQUOTE(last_attempt_error), consecutive_failures = 1 WH
    invariants: 13 checks, 0 violated
    read back 139746 seeded jobs: 3539312 values compared, 0 violated
    fence: 2 checks, 0 violated
  Scale 10, schema v1 writers: loaded as schema v1 in 4.98s
    migrateToLatest 1.39s: 0.36s before the fence, 1.03s after
           82.2ms  CREATE TABLE IF NOT EXISTS queuert_migration ( name VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NUL
          226.6ms  CREATE INDEX queuert_chain_blocking_idx ON queuert_job (type_name, blocking, chain_index, created_at)
          255.8ms  UPDATE queuert_job h SET h.blocking = TRUE WHERE h.chain_index = 0 AND h.blocking = FALSE AND h.id IN (SELECT
          528.3ms  UPDATE queuert_job j LEFT JOIN ( SELECT jb.job_id, COUNT(*) AS remaining FROM queuert_job_blocker jb LEFT JOIN
           69.6ms  UPDATE queuert_job j SET j.status = 'pending', j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)) WHE
           58.2ms  UPDATE queuert_job j SET j.status = 'pending', j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)), j.
           95.3ms  UPDATE queuert_job SET last_attempt_error_text = JSON_UNQUOTE(last_attempt_error), consecutive_failures = 1 WH
    schema v1 writes: before 1853 ops/s (p99 17.0ms), until the fence 655 ops/s (p99 103.9ms), longest stall 104.4ms, 9511 committed, 27 fenced, 0 other errors
    invariants: 13 checks, 0 violated
    read back 139746 seeded jobs: 3539312 values compared, 0 violated
    read back 13289 jobs schema v1 writers wrote: 106312 values compared, 0 violated
    fence: 2 checks, 0 violated

  scale 100: 1,388,572 jobs, 693,098 blocker rows, generated as schema v1 in 7.75s
  Scale 100: loaded as schema v1 in 67.79s
    migrateToLatest 11.31s: 1.57s before the fence, 9.74s after
         1526.1ms  CREATE INDEX queuert_chain_blocking_idx ON queuert_job (type_name, blocking, chain_index, created_at)
         2576.5ms  UPDATE queuert_job h SET h.blocking = TRUE WHERE h.chain_index = 0 AND h.blocking = FALSE AND h.id IN (SELECT
         5175.5ms  UPDATE queuert_job j LEFT JOIN ( SELECT jb.job_id, COUNT(*) AS remaining FROM queuert_job_blocker jb LEFT JOIN
          512.0ms  UPDATE queuert_job j SET j.status = 'pending', j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)) WHE
          531.7ms  UPDATE queuert_job j SET j.status = 'pending', j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)), j.
          912.2ms  UPDATE queuert_job SET last_attempt_error_text = JSON_UNQUOTE(last_attempt_error), consecutive_failures = 1 WH
    invariants: 13 checks, 0 violated
    read back 1388572 seeded jobs: 35170645 values compared, 0 violated
    fence: 2 checks, 0 violated
  Scale 100, schema v1 writers: loaded as schema v1 in 68.49s
    migrateToLatest 15.46s: 4.52s before the fence, 10.94s after
         4314.5ms  CREATE INDEX queuert_chain_blocking_idx ON queuert_job (type_name, blocking, chain_index, created_at)
           88.6ms  ALTER TABLE queuert_job ADD COLUMN consecutive_failures INT NOT NULL DEFAULT 0 AFTER attempt, ADD COLUMN last_
         2925.5ms  UPDATE queuert_job h SET h.blocking = TRUE WHERE h.chain_index = 0 AND h.blocking = FALSE AND h.id IN (SELECT
         6049.7ms  UPDATE queuert_job j LEFT JOIN ( SELECT jb.job_id, COUNT(*) AS remaining FROM queuert_job_blocker jb LEFT JOIN
          526.7ms  UPDATE queuert_job j SET j.status = 'pending', j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)) WHE
          535.4ms  UPDATE queuert_job j SET j.status = 'pending', j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)), j.
          869.6ms  UPDATE queuert_job SET last_attempt_error_text = JSON_UNQUOTE(last_attempt_error), consecutive_failures = 1 WH
    schema v1 writes: before 1755 ops/s (p99 18.5ms), until the fence 1321 ops/s (p99 27.4ms), longest stall 112.9ms, 14749 committed, 22 fenced, 0 other errors
    invariants: 13 checks, 0 violated
    read back 1388572 seeded jobs: 35170645 values compared, 0 violated
    read back 21002 jobs schema v1 writers wrote: 168016 values compared, 0 violated
    fence: 2 checks, 0 violated
```
