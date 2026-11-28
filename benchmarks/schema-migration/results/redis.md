# Schema migration 002_schema_v2 on Redis

Redis 8, ioredis

```text
  scale 1: 14,192 jobs, 6,932 blocker rows, generated as schema v1 in 0.10s
  Scale 1: loaded as schema v1 in 0.29s, 29904 keys, 24.56M
    migrateToLatest 0.19s: fence and blocking flags 0.03s, consecutiveFailures rewrite 0.16s
    read back 14192 seeded jobs: 359386 values compared, 0 violated
    fence: 2 checks, 0 violated

  scale 10: 139,746 jobs, 69,357 blocker rows, generated as schema v1 in 0.64s
  Scale 10: loaded as schema v1 in 2.70s, 289089 keys, 181.06M
    migrateToLatest 1.78s: fence and blocking flags 0.21s, consecutiveFailures rewrite 1.57s
    read back 139746 seeded jobs: 3539527 values compared, 0 violated
    fence: 2 checks, 0 violated

  scale 100: 1,388,572 jobs, 693,098 blocker rows, generated as schema v1 in 7.44s
  Scale 100: loaded as schema v1 in 29.24s, 2866883 keys, 1.63G
    migrateToLatest 19.22s: fence and blocking flags 1.99s, consecutiveFailures rewrite 17.23s
    read back 1388572 seeded jobs: 35172829 values compared, 0 violated
    fence: 2 checks, 0 violated
```
