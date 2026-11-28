# Schema migration 002_schema_v2 on SQLite

better-sqlite3, file in WAL mode

```text
  scale 1: 14,192 jobs, 6,932 blocker rows, generated as schema v1 in 0.08s
  Scale 1: loaded as schema v1 in 0.23s, database file 9 MB
    migrateToLatest 0.00s, one transaction
    invariants: 9 checks, 0 violated
    read back 14192 seeded jobs: 359386 values compared, 0 violated
    fence: 2 checks, 0 violated

  scale 10: 139,746 jobs, 69,357 blocker rows, generated as schema v1 in 0.67s
  Scale 10: loaded as schema v1 in 2.77s, database file 83 MB
    migrateToLatest 0.06s, one transaction
    invariants: 9 checks, 0 violated
    read back 139746 seeded jobs: 3539527 values compared, 0 violated
    fence: 2 checks, 0 violated

  scale 100: 1,388,572 jobs, 693,098 blocker rows, generated as schema v1 in 7.87s
  Scale 100: loaded as schema v1 in 54.05s, database file 830 MB
    migrateToLatest 0.65s, one transaction
    invariants: 9 checks, 0 violated
    read back 1388572 seeded jobs: 35172829 values compared, 0 violated
    fence: 2 checks, 0 violated
```
