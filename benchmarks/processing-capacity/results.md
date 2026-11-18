# Processing capacity

Last run 2026-11-18 · commit 2748cec8 · load average 5.41 · state-mysql-mysql2, state-mariadb-mysql2

## Creation (chains/s): State adapter (noop notify)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 489652 |        686355 |
| In-process (async)       | 401724 |        681409 |
| SQLite (better-sqlite3)  |  58918 |        154246 |
| SQLite (node:sqlite)     |  60002 |        128835 |
| PostgreSQL (postgres-js) |   1960 |         55978 |
| PostgreSQL (pg)          |   2039 |         58644 |
| MySQL (mysql2)           |    861 |         22582 |
| MariaDB (mysql2)         |    845 |         25951 |
| Redis (redis)            |   6538 |         37979 |
| Redis (ioredis)          |   6679 |         37995 |

## Creation (chains/s): Notify adapter (in-process state)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 484043 |        659918 |
| In-process (async)       | 361934 |        659996 |
| Redis (redis)            |   8514 |        352575 |
| Redis (ioredis)          |   8823 |        350456 |
| PostgreSQL (pg)          |   6982 |        309081 |
| PostgreSQL (postgres-js) |   8174 |        325871 |
| NATS                     |   8177 |        335215 |
| IPC                      | 455494 |        644986 |

## Completion, no-op handler (jobs/s): State adapter (noop notify)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 261650 |  290363 |   287359 |
| In-process (async)       | 226158 |  229926 |   242875 |
| SQLite (better-sqlite3)  |  21628 |   25476 |    27135 |
| SQLite (node:sqlite)     |  19484 |   22913 |    24477 |
| PostgreSQL (postgres-js) |   1014 |    2950 |     5312 |
| PostgreSQL (pg)          |   1050 |    3019 |     5512 |
| MySQL (mysql2)           |    393 |    1052 |     2198 |
| MariaDB (mysql2)         |    303 |     948 |     2202 |
| Redis (redis)            |   2264 |    6210 |    10380 |
| Redis (ioredis)          |   2285 |    5553 |    12693 |

## Completion, no-op handler (jobs/s): Notify adapter (in-process state)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 211958 |  232045 |   231644 |
| In-process (async)       | 174226 |  159049 |   176317 |
| Redis (redis)            |   3004 |   10549 |    29738 |
| Redis (ioredis)          |   3020 |   12820 |    58193 |
| PostgreSQL (pg)          |   2703 |   18100 |    21977 |
| PostgreSQL (postgres-js) |   2670 |   17309 |    21879 |
| NATS                     |   6240 |   20063 |    50633 |
| IPC                      | 187356 |  213100 |   207217 |
