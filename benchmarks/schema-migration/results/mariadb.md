# Schema migration 002_schema_v2 on MariaDB

mariadb:13, mysql2

```text
  scale 1: 14,192 jobs, 6,932 blocker rows, generated as schema v1 in 0.09s
  Scale 1: loaded as schema v1 in 0.65s
    migrateToLatest 0.10s: 0.04s before the fence, 0.06s after
    invariants: 13 checks, 0 violated
    read back 14192 seeded jobs: 359363 values compared, 0 violated
    fence: 2 checks, 0 violated
  Scale 1, schema v1 writers: loaded as schema v1 in 0.63s
    migrateToLatest 0.21s: 0.08s before the fence, 0.13s after
           54.8ms  UPDATE queuert_job j LEFT JOIN ( SELECT jb.job_id, COUNT(*) AS remaining FROM queuert_job_blocker jb LEFT JOIN
    schema v1 writes: before 2074 ops/s (p99 6.5ms), until the fence 1251 ops/s (p99 12.2ms), longest stall 12.2ms, 10476 committed, 26 fenced, 0 other errors
    invariants: 13 checks, 0 violated
    read back 14192 seeded jobs: 359363 values compared, 0 violated
    read back 15458 jobs schema v1 writers wrote: 123664 values compared, 0 violated
    fence: 2 checks, 0 violated

  scale 10: 139,746 jobs, 69,357 blocker rows, generated as schema v1 in 0.67s
  Scale 10: loaded as schema v1 in 6.60s
    migrateToLatest 0.69s: 0.15s before the fence, 0.55s after
          123.5ms  CREATE INDEX queuert_chain_blocking_idx ON queuert_job (type_name, blocking, chain_index, created_at)
           81.8ms  UPDATE queuert_job h SET h.blocking = TRUE WHERE h.chain_index = 0 AND h.blocking = FALSE AND h.id IN (SELECT
          305.8ms  UPDATE queuert_job j LEFT JOIN ( SELECT jb.job_id, COUNT(*) AS remaining FROM queuert_job_blocker jb LEFT JOIN
           58.5ms  UPDATE queuert_job SET last_attempt_error_text = JSON_UNQUOTE(last_attempt_error), consecutive_failures = 1 WH
    invariants: 13 checks, 0 violated
    read back 139746 seeded jobs: 3539312 values compared, 0 violated
    fence: 2 checks, 0 violated
  Scale 10, schema v1 writers: loaded as schema v1 in 6.51s
    migrateToLatest 1.22s: 0.53s before the fence, 0.69s after
          484.2ms  CREATE INDEX queuert_chain_blocking_idx ON queuert_job (type_name, blocking, chain_index, created_at)
          163.0ms  UPDATE queuert_job h SET h.blocking = TRUE WHERE h.chain_index = 0 AND h.blocking = FALSE AND h.id IN (SELECT
          351.0ms  UPDATE queuert_job j LEFT JOIN ( SELECT jb.job_id, COUNT(*) AS remaining FROM queuert_job_blocker jb LEFT JOIN
           69.4ms  UPDATE queuert_job SET last_attempt_error_text = JSON_UNQUOTE(last_attempt_error), consecutive_failures = 1 WH
    schema v1 writes: before 2177 ops/s (p99 6.3ms), until the fence 1961 ops/s (p99 10.4ms), longest stall 16.1ms, 11928 committed, 23 fenced, 0 other errors
    invariants: 13 checks, 0 violated
    read back 139746 seeded jobs: 3539312 values compared, 0 violated
    read back 17789 jobs schema v1 writers wrote: 142312 values compared, 0 violated
    fence: 2 checks, 0 violated

  scale 100: 1,388,572 jobs, 693,098 blocker rows, generated as schema v1 in 7.74s
  Scale 100: loaded as schema v1 in 75.02s
    migrateToLatest 9.52s: 1.36s before the fence, 8.15s after
         1325.9ms  CREATE INDEX queuert_chain_blocking_idx ON queuert_job (type_name, blocking, chain_index, created_at)
          865.5ms  UPDATE queuert_job h SET h.blocking = TRUE WHERE h.chain_index = 0 AND h.blocking = FALSE AND h.id IN (SELECT
         5590.0ms  UPDATE queuert_job j LEFT JOIN ( SELECT jb.job_id, COUNT(*) AS remaining FROM queuert_job_blocker jb LEFT JOIN
          397.0ms  UPDATE queuert_job j SET j.status = 'pending', j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)) WHE
          435.2ms  UPDATE queuert_job j SET j.status = 'pending', j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)), j.
          804.2ms  UPDATE queuert_job SET last_attempt_error_text = JSON_UNQUOTE(last_attempt_error), consecutive_failures = 1 WH
    invariants: 13 checks, 0 violated
    read back 1388572 seeded jobs: 35170645 values compared, 0 violated
    fence: 2 checks, 0 violated
  Scale 100, schema v1 writers: loaded as schema v1 in 74.53s
    migrateToLatest 10.81s: 2.43s before the fence, 8.38s after
         2361.0ms  CREATE INDEX queuert_chain_blocking_idx ON queuert_job (type_name, blocking, chain_index, created_at)
          973.9ms  UPDATE queuert_job h SET h.blocking = TRUE WHERE h.chain_index = 0 AND h.blocking = FALSE AND h.id IN (SELECT
         5689.6ms  UPDATE queuert_job j LEFT JOIN ( SELECT jb.job_id, COUNT(*) AS remaining FROM queuert_job_blocker jb LEFT JOIN
          397.4ms  UPDATE queuert_job j SET j.status = 'pending', j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)) WHE
          428.3ms  UPDATE queuert_job j SET j.status = 'pending', j.scheduled_at = GREATEST(j.scheduled_at, UTC_TIMESTAMP(6)), j.
          805.4ms  UPDATE queuert_job SET last_attempt_error_text = JSON_UNQUOTE(last_attempt_error), consecutive_failures = 1 WH
    schema v1 writes: before 2135 ops/s (p99 6.7ms), until the fence 1304 ops/s (p99 46.5ms), longest stall 103.3ms, 13855 committed, 29 fenced, 0 other errors
    invariants: 13 checks, 0 violated
    read back 1388572 seeded jobs: 35170645 values compared, 0 violated
    read back 20013 jobs schema v1 writers wrote: 160104 values compared, 0 violated
    fence: 2 checks, 0 violated
```
