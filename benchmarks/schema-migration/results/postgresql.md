# Schema migration 002_schema_v2 on PostgreSQL

PostgreSQL 18, pg

```text
  scale 1: 14,192 jobs, 6,932 blocker rows, generated as schema v1 in 0.10s
  Scale 1: loaded as schema v1 in 0.24s, job table 4984 kB
    migrateToLatest 0.20s: copy 0.13s in 16 batches (p50 8.5ms, max 10.4ms), ACCESS EXCLUSIVE wait 0.2ms, held 16.6ms, ANALYZE 0.04s
    migrateToLatest: 1 checks, 0 violated
    invariants: 14 checks, 0 violated
    read back 14192 seeded jobs: 359363 values compared, 0 violated
    fence: 2 checks, 0 violated
  Scale 1, schema v1 writers: loaded as schema v1 in 0.24s, job table 4984 kB
    migrateToLatest 1.09s: copy 0.92s in 46 batches (p50 18.7ms, max 47.1ms), ACCESS EXCLUSIVE wait 1.2ms, held 67.9ms, ANALYZE 0.09s
      swap      37.0ms  UPDATE public.queuert_job_v2 j SET blockers_remaining = c.blockers_remaining, status = CASE WHEN c.blockers_re
    schema v1 writes: before 4199 ops/s (p99 4.0ms), during copy 3321 ops/s (p50 2.4ms, p99 6.7ms), longest stall 69.2ms, 24082 committed, 23 fenced, 0 other errors
    migrateToLatest: 1 checks, 0 violated
    invariants: 14 checks, 0 violated
    read back 14192 seeded jobs: 359363 values compared, 0 violated
    read back 32367 jobs schema v1 writers wrote: 258936 values compared, 0 violated
    fence: 2 checks, 0 violated

  scale 10: 139,746 jobs, 69,357 blocker rows, generated as schema v1 in 0.66s
  Scale 10: loaded as schema v1 in 2.09s, job table 47 MB
    migrateToLatest 1.58s: copy 1.40s in 141 batches (p50 9.7ms, max 14.3ms), ACCESS EXCLUSIVE wait 0.2ms, held 68.4ms, ANALYZE 0.09s
      swap      25.0ms  UPDATE public.queuert_job_v2 h SET blocking = EXISTS ( SELECT 1 FROM public.queuert_job_blocker jb WHERE jb.bl
      swap      30.4ms  UPDATE public.queuert_job_v2 j SET blockers_remaining = c.blockers_remaining, status = CASE WHEN c.blockers_re
    migrateToLatest: 1 checks, 0 violated
    invariants: 14 checks, 0 violated
    read back 139746 seeded jobs: 3539312 values compared, 0 violated
    fence: 2 checks, 0 violated
  Scale 10, schema v1 writers: loaded as schema v1 in 2.02s, job table 47 MB
    migrateToLatest 3.92s: copy 3.62s in 177 batches (p50 19.0ms, max 49.3ms), ACCESS EXCLUSIVE wait 2.2ms, held 181.4ms, ANALYZE 0.10s
      swap      88.1ms  UPDATE public.queuert_job_v2 h SET blocking = EXISTS ( SELECT 1 FROM public.queuert_job_blocker jb WHERE jb.bl
      swap      71.1ms  UPDATE public.queuert_job_v2 j SET blockers_remaining = c.blockers_remaining, status = CASE WHEN c.blockers_re
    schema v1 writes: before 4167 ops/s (p99 4.0ms), during copy 3251 ops/s (p50 2.6ms, p99 5.7ms), longest stall 177.6ms, 32649 committed, 37 fenced, 0 other errors
    migrateToLatest: 1 checks, 0 violated
    invariants: 14 checks, 0 violated
    read back 139746 seeded jobs: 3539312 values compared, 0 violated
    read back 43720 jobs schema v1 writers wrote: 349760 values compared, 0 violated
    fence: 2 checks, 0 violated

  scale 100: 1,388,572 jobs, 693,098 blocker rows, generated as schema v1 in 7.54s
  Scale 100: loaded as schema v1 in 22.92s, job table 469 MB
    migrateToLatest 37.06s: copy 36.75s in 1390 batches (p50 25.5ms, max 93.0ms), ACCESS EXCLUSIVE wait 0.2ms, held 144.4ms, ANALYZE 0.14s
      swap     114.9ms  UPDATE public.queuert_job_v2 j SET status = 'pending', attempt_at = NULL, attempt_by = NULL, attempt_token = N
    migrateToLatest: 1 checks, 0 violated
    invariants: 14 checks, 0 violated
    read back 1388572 seeded jobs: 35170645 values compared, 0 violated
    fence: 2 checks, 0 violated
  Scale 100, schema v1 writers: loaded as schema v1 in 22.50s, job table 469 MB
    migrateToLatest 67.02s: copy 64.89s in 1505 batches (p50 40.7ms, max 307.7ms), ACCESS EXCLUSIVE wait 5.8ms, held 1805.4ms, ANALYZE 0.19s
      swap     300.7ms  UPDATE public.queuert_job_v2 h SET blocking = EXISTS ( SELECT 1 FROM public.queuert_job_blocker jb WHERE jb.bl
      swap    1321.4ms  UPDATE public.queuert_job_v2 j SET blockers_remaining = c.blockers_remaining, status = CASE WHEN c.blockers_re
      swap     147.6ms  UPDATE public.queuert_job_v2 j SET status = 'pending', attempt_at = NULL, attempt_by = NULL, attempt_token = N
    schema v1 writes: before 4062 ops/s (p99 4.7ms), during copy 1755 ops/s (p50 4.0ms, p99 18.6ms), longest stall 1790.3ms, 134594 committed, 14 fenced, 0 other errors
    migrateToLatest: 1 checks, 0 violated
    invariants: 14 checks, 0 violated
    read back 1388572 seeded jobs: 35170645 values compared, 0 violated
    read back 174297 jobs schema v1 writers wrote: 1394376 values compared, 0 violated
    fence: 2 checks, 0 violated
```
