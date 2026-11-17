# Processing capacity

Last run 2026-11-17 · commit 8068bd33 · load average 3.59 · state-mysql-mysql2, state-mariadb-mysql2

## Creation (chains/s): State adapter (noop notify)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 303505 |        436712 |
| In-process (async)       | 250214 |        446161 |
| SQLite (better-sqlite3)  |  36629 |         98782 |
| SQLite (node:sqlite)     |  37590 |         83849 |
| PostgreSQL (postgres-js) |   1144 |         27228 |
| PostgreSQL (pg)          |   1435 |         27608 |
| MySQL (mysql2)           |    479 |         11558 |
| MariaDB (mysql2)         |    481 |         14390 |
| Redis (redis)            |   3407 |         26366 |
| Redis (ioredis)          |   3917 |         25882 |

## Creation (chains/s): Notify adapter (in-process state)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 299028 |        427717 |
| In-process (async)       | 210997 |        418096 |
| Redis (redis)            |   3905 |        171885 |
| Redis (ioredis)          |   4807 |        207841 |
| PostgreSQL (pg)          |   4679 |        201538 |
| PostgreSQL (postgres-js) |   5111 |        200564 |
| NATS                     |   5039 |        224207 |
| IPC                      | 280672 |        433740 |

## Completion, no-op handler (jobs/s): State adapter (noop notify)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 156736 |  177193 |   175298 |
| In-process (async)       | 137325 |  138294 |   155352 |
| SQLite (better-sqlite3)  |  13477 |   16107 |    17053 |
| SQLite (node:sqlite)     |  11936 |   14449 |    15225 |
| PostgreSQL (postgres-js) |    583 |    1781 |     3540 |
| PostgreSQL (pg)          |    574 |    1814 |     3792 |
| MySQL (mysql2)           |    235 |     660 |     1521 |
| MariaDB (mysql2)         |    239 |     595 |     1513 |
| Redis (redis)            |   1314 |    3180 |     5469 |
| Redis (ioredis)          |   1345 |    3049 |     7350 |

## Completion, no-op handler (jobs/s): Notify adapter (in-process state)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 121378 |  141732 |   137065 |
| In-process (async)       |  64931 |   84749 |   101076 |
| Redis (redis)            |   1547 |    4979 |    15407 |
| Redis (ioredis)          |   1520 |    8968 |    35142 |
| PostgreSQL (pg)          |   1611 |   11622 |    16886 |
| PostgreSQL (postgres-js) |   1539 |   11509 |    16425 |
| NATS                     |   3982 |   12014 |    33342 |
| IPC                      | 113225 |  127468 |   131280 |
